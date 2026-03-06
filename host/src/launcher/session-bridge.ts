import { setTimeout as delay } from 'node:timers/promises'
import type {
  SessionBridgeEvent,
  SessionBridgeEventsResult,
  SessionBridgeMessageInput,
  SessionBridgeMessageResult,
  SessionBridgeStatus,
  SessionSelectionSource
} from '../../../app/types/launcher.js'
import {
  createWorkspaceSessionKey,
  persistSessionId,
  readPersistedSessionId
} from './session-store.js'

const DEFAULT_FETCH_TIMEOUT_MS = 2_000

const SESSION_PATH = '/session'
const SESSION_MESSAGE_PATH = '/session/{sessionId}/message'

type HttpMethod = 'GET' | 'POST'

interface OpenCodeSessionSummary {
  id: string
}

interface SessionBridgeOptions {
  endpoint: string | null
  repoId: string
  repoPath: string
  explicitSessionId?: string | null
  authToken?: string | null
  storePath?: string
  fetchTimeoutMs?: number
}

interface SessionBridgeHandle {
  getStatus(): SessionBridgeStatus
  getActiveSessionId(): string | null
  sendMessage(input: SessionBridgeMessageInput): Promise<SessionBridgeMessageResult>
  fetchEvents(cursor?: string | null): Promise<SessionBridgeEventsResult>
}

interface RequestOptions {
  method: HttpMethod
  body?: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeEndpoint(endpoint: string | null): string | null {
  if (!endpoint || endpoint.trim().length === 0) {
    return null
  }

  try {
    const parsed = new URL(endpoint)
    parsed.hash = ''
    const normalized = parsed.toString()
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  } catch {
    return null
  }
}

function resolveFetchTimeoutMs(rawValue: number | undefined): number {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) {
    return DEFAULT_FETCH_TIMEOUT_MS
  }

  return Math.floor(rawValue)
}

function resolveAuthToken(options: SessionBridgeOptions): string | null {
  const direct = options.authToken?.trim()
  if (direct) {
    return direct
  }

  const envToken = process.env.STEWARD_OPENCODE_AUTH_TOKEN?.trim()
    || process.env.OPENCODE_SERVER_PASSWORD?.trim()

  return envToken || null
}

function resolveAuthUsername(): string {
  return process.env.STEWARD_OPENCODE_AUTH_USERNAME?.trim()
    || process.env.OPENCODE_SERVER_USERNAME?.trim()
    || 'opencode'
}

function buildBasicAuthHeader(username: string, password: string | null): string | null {
  if (!password) {
    return null
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function createDisabledStatus(message: string): SessionBridgeStatus {
  return {
    state: 'disabled',
    activeSessionId: null,
    source: 'none',
    workspaceKey: 'unbound',
    endpoint: null,
    lastResolvedAt: nowIso(),
    message,
    diagnostics: []
  }
}

function normalizePath(path: string, sessionId?: string): string {
  return sessionId ? path.replace('{sessionId}', encodeURIComponent(sessionId)) : path
}

function parseSessionId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  return null
}

function parseSessionCollection(value: unknown): OpenCodeSessionSummary[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }

      const candidate = entry as Record<string, unknown>
      const id = parseSessionId(candidate.id)
      return id ? { id } : null
    })
    .filter((entry): entry is OpenCodeSessionSummary => entry !== null)
}

function parseCreatedSessionId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const objectValue = value as Record<string, unknown>
  return parseSessionId(objectValue.id)
}

function parseMessageResult(value: unknown, fallbackSessionId: string): SessionBridgeMessageResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      sessionId: fallbackSessionId,
      accepted: true,
      requestId: null
    }
  }

  const objectValue = value as Record<string, unknown>
  const info = objectValue.info && typeof objectValue.info === 'object' && !Array.isArray(objectValue.info)
    ? objectValue.info as Record<string, unknown>
    : null

  const sessionId = parseSessionId(info?.sessionID)
    || fallbackSessionId
  const accepted = true
  const requestId = parseSessionId(info?.id)

  return {
    sessionId,
    accepted,
    requestId
  }
}

interface OpenCodeSessionMessage {
  id: string
  sessionId: string
  role: string
  parts: Array<Record<string, unknown>>
  createdAt: number
}

function parseSessionMessages(value: unknown, fallbackSessionId: string): OpenCodeSessionMessage[] {
  const candidates: unknown[] = Array.isArray(value) ? value : []

  const parsed: OpenCodeSessionMessage[] = []
  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }

    const objectEntry = entry as Record<string, unknown>
    const info = objectEntry.info
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      continue
    }

    const infoObject = info as Record<string, unknown>
    const id = parseSessionId(infoObject.id)
    if (!id) {
      continue
    }

    const role = parseSessionId(infoObject.role) || 'message'
    const sessionId = parseSessionId(infoObject.sessionID)
      || fallbackSessionId
    const time = infoObject.time
    const createdAt = (time && typeof time === 'object' && !Array.isArray(time)
      && typeof (time as Record<string, unknown>).created === 'number'
      && Number.isFinite((time as Record<string, unknown>).created as number))
      ? Math.floor((time as Record<string, unknown>).created as number)
      : 0
    const parts = Array.isArray(objectEntry.parts)
      ? objectEntry.parts.filter((part): part is Record<string, unknown> => !!part && typeof part === 'object' && !Array.isArray(part))
      : []

    parsed.push({
      id,
      sessionId,
      role,
      parts,
      createdAt
    })
  }

  return parsed.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt
    }

    return left.id.localeCompare(right.id)
  })
}

function mapMessagesToEvents(
  messages: OpenCodeSessionMessage[],
  cursor?: string | null
): { events: SessionBridgeEvent[]; cursor: string | null } {
  const normalizedCursor = cursor?.trim() || null
  let startIndex = 0

  if (normalizedCursor) {
    const matchedIndex = messages.findIndex((message) => message.id === normalizedCursor)
    if (matchedIndex >= 0) {
      startIndex = matchedIndex + 1
    }
  }

  const events: SessionBridgeEvent[] = []

  for (const message of messages.slice(startIndex)) {
    if (message.parts.length === 0) {
      events.push({
        id: message.id,
        type: `message.${message.role}`,
        payload: {
          messageId: message.id,
          role: message.role
        }
      })
      continue
    }

    message.parts.forEach((part, index) => {
      const partType = parseSessionId(part.type) || 'part'
      const partId = parseSessionId(part.id) || `part-${index + 1}`
      const text = typeof part.text === 'string' ? part.text : null

      events.push({
        id: `${message.id}:${partId}`,
        type: `message.${message.role}.${partType}`,
        payload: text ?? part
      })
    })
  }

  const nextCursor = messages[messages.length - 1]?.id || normalizedCursor || null

  return {
    events,
    cursor: nextCursor
  }
}

function isLikelyHtmlResponse(text: string): boolean {
  const sample = text.trim().slice(0, 256).toLowerCase()
  return sample.startsWith('<!doctype html')
    || sample.startsWith('<html')
    || sample.includes('<head')
    || sample.includes('<body')
}

export async function startSessionBridge(options: SessionBridgeOptions): Promise<SessionBridgeHandle> {
  const endpoint = normalizeEndpoint(options.endpoint)
  if (!endpoint) {
    const status = createDisabledStatus('Session bridge is disabled because no OpenCode endpoint is available.')

    return {
      getStatus: () => ({ ...status, diagnostics: [...status.diagnostics] }),
      getActiveSessionId: () => null,
      sendMessage: async () => {
        throw new Error('Session bridge is disabled: no endpoint available')
      },
      fetchEvents: async () => {
        throw new Error('Session bridge is disabled: no endpoint available')
      }
    }
  }

  const fetchTimeoutMs = resolveFetchTimeoutMs(options.fetchTimeoutMs)
  const authToken = resolveAuthToken(options)
  const authUsername = resolveAuthUsername()
  const authHeader = buildBasicAuthHeader(authUsername, authToken)
  const workspaceKey = createWorkspaceSessionKey(options.repoId, endpoint)
  const diagnostics: string[] = []

  let activeSessionId: string | null = null
  let source: SessionSelectionSource = 'none'
  let state: SessionBridgeStatus['state'] = 'ready'
  let message = 'Active session bridge is ready.'

  async function request(path: string, requestOptions: RequestOptions): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, fetchTimeoutMs)

    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: requestOptions.method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(authHeader ? { authorization: authHeader } : {})
        },
        ...(requestOptions.body !== undefined
          ? { body: JSON.stringify(requestOptions.body) }
          : {})
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${body || response.statusText}`)
      }

      const text = await response.text()
      if (!text.trim()) {
        return null
      }

      try {
        return JSON.parse(text) as unknown
      } catch {
        if (isLikelyHtmlResponse(text)) {
          throw new Error(
            'OpenCode endpoint returned HTML instead of JSON. Ensure launcher points to an OpenCode API server (opencode serve), not a web-only UI endpoint.'
          )
        }

        throw new Error(`OpenCode endpoint returned invalid JSON for ${path}.`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async function listSessions(): Promise<OpenCodeSessionSummary[]> {
    const payload = await request(SESSION_PATH, {
      method: 'GET'
    })

    return parseSessionCollection(payload)
  }

  async function createSession(): Promise<string> {
    const payload = await request(SESSION_PATH, {
      method: 'POST',
      body: {}
    })

    const createdId = parseCreatedSessionId(payload)
    if (!createdId) {
      throw new Error('Session creation response did not contain a session id')
    }

    return createdId
  }

  let availableSessions: OpenCodeSessionSummary[] = []

  try {
    availableSessions = await listSessions()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    diagnostics.push(`Failed to list sessions: ${errorMessage}`)
    state = 'degraded'
    message = 'Unable to verify existing sessions from OpenCode endpoint.'
  }

  const explicitSessionId = options.explicitSessionId?.trim() || null
  const persistedSessionId = explicitSessionId
    ? null
    : await readPersistedSessionId(workspaceKey, { storePath: options.storePath })

  if (explicitSessionId) {
    const hasExplicit = availableSessions.some((session) => session.id === explicitSessionId)
    if (availableSessions.length > 0 && !hasExplicit) {
      diagnostics.push(`Explicit session ${explicitSessionId} was not found; creating a new session.`)
      activeSessionId = await createSession().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        diagnostics.push(`Failed to create replacement session for explicit id ${explicitSessionId}: ${errorMessage}`)
        return null
      })
      source = activeSessionId ? 'created' : 'none'
    } else {
      activeSessionId = explicitSessionId
      source = 'explicit'
    }
  } else if (persistedSessionId) {
    const hasPersisted = availableSessions.some((session) => session.id === persistedSessionId)
    if (availableSessions.length > 0 && !hasPersisted) {
      diagnostics.push(`Persisted session ${persistedSessionId} was not found; creating a new session.`)
      activeSessionId = await createSession().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        diagnostics.push(`Failed to create replacement session for persisted id ${persistedSessionId}: ${errorMessage}`)
        return null
      })
      source = activeSessionId ? 'created' : 'none'
    } else {
      activeSessionId = persistedSessionId
      source = 'persisted'
    }
  } else {
    activeSessionId = await createSession().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      diagnostics.push(`Failed to create a new active session: ${errorMessage}`)
      return null
    })
    source = activeSessionId ? 'created' : 'none'
  }

  if (activeSessionId) {
    await persistSessionId(workspaceKey, activeSessionId, {
      storePath: options.storePath
    }).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      diagnostics.push(`Failed to persist active session ${activeSessionId}: ${errorMessage}`)
    })
  }

  if (!activeSessionId) {
    state = 'degraded'
    message = 'Session bridge could not resolve or create an active session.'
  } else {
    message = `Session bridge bound to active session ${activeSessionId} (${source}).`
  }

  const bridgeStatus = (): SessionBridgeStatus => ({
    state,
    activeSessionId,
    source,
    workspaceKey,
    endpoint,
    lastResolvedAt: nowIso(),
    message,
    diagnostics: [...diagnostics]
  })

  return {
    getStatus: bridgeStatus,
    getActiveSessionId: () => activeSessionId,
    sendMessage: async (input: SessionBridgeMessageInput): Promise<SessionBridgeMessageResult> => {
      if (!activeSessionId) {
        throw new Error('Session bridge has no active session id')
      }

      const payload = await request(normalizePath(SESSION_MESSAGE_PATH, activeSessionId), {
        method: 'POST',
        body: {
          parts: [
            {
              type: 'text',
              text: input.content
            }
          ]
        }
      })

      return parseMessageResult(payload, activeSessionId)
    },
    fetchEvents: async (cursor?: string | null): Promise<SessionBridgeEventsResult> => {
      if (!activeSessionId) {
        throw new Error('Session bridge has no active session id')
      }

      const payload = await request(normalizePath(SESSION_MESSAGE_PATH, activeSessionId), {
        method: 'GET'
      })
      const messages = parseSessionMessages(payload, activeSessionId)
      const mapped = mapMessagesToEvents(messages, cursor)

      return {
        sessionId: activeSessionId,
        events: mapped.events,
        cursor: mapped.cursor
      }
    }
  }
}

export async function waitForSessionBridgeReady(
  createBridge: () => Promise<SessionBridgeHandle>,
  options: { retries?: number; delayMs?: number } = {}
): Promise<SessionBridgeHandle> {
  const retries = typeof options.retries === 'number' && options.retries > 0
    ? Math.floor(options.retries)
    : 1
  const delayMs = typeof options.delayMs === 'number' && options.delayMs > 0
    ? Math.floor(options.delayMs)
    : 0

  let lastError: unknown = null

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await createBridge()
    } catch (error) {
      lastError = error
      if (attempt < retries - 1 && delayMs > 0) {
        await delay(delayMs)
      }
    }
  }

  throw lastError || new Error('Session bridge initialization failed')
}
