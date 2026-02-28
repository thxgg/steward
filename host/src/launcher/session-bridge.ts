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

const LIST_SESSION_PATHS = ['/api/sessions', '/sessions']
const CREATE_SESSION_PATHS = ['/api/sessions', '/sessions']
const MESSAGE_PATHS = [
  '/api/sessions/{sessionId}/messages',
  '/sessions/{sessionId}/messages'
]
const EVENTS_PATHS = [
  '/api/sessions/{sessionId}/events',
  '/sessions/{sessionId}/events'
]

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
    || process.env.OPENCODE_AUTH_TOKEN?.trim()
    || process.env.OPENCODE_API_KEY?.trim()

  return envToken || null
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
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null
        }

        const candidate = entry as Record<string, unknown>
        const id = parseSessionId(candidate.id) || parseSessionId(candidate.sessionId)
        return id ? { id } : null
      })
      .filter((entry): entry is OpenCodeSessionSummary => entry !== null)
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  const objectValue = value as Record<string, unknown>
  if (Array.isArray(objectValue.sessions)) {
    return parseSessionCollection(objectValue.sessions)
  }

  if (Array.isArray(objectValue.data)) {
    return parseSessionCollection(objectValue.data)
  }

  return []
}

function parseCreatedSessionId(value: unknown): string | null {
  if (parseSessionId(value)) {
    return parseSessionId(value)
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const objectValue = value as Record<string, unknown>
  return parseSessionId(objectValue.id)
    || parseSessionId(objectValue.sessionId)
    || parseSessionId((objectValue.session as Record<string, unknown> | undefined)?.id)
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
  const sessionId = parseSessionId(objectValue.sessionId)
    || parseSessionId((objectValue.session as Record<string, unknown> | undefined)?.id)
    || fallbackSessionId
  const accepted = typeof objectValue.accepted === 'boolean'
    ? objectValue.accepted
    : true
  const requestId = parseSessionId(objectValue.requestId)

  return {
    sessionId,
    accepted,
    requestId
  }
}

function parseEventsResult(value: unknown, fallbackSessionId: string): SessionBridgeEventsResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      sessionId: fallbackSessionId,
      events: [],
      cursor: null
    }
  }

  const objectValue = value as Record<string, unknown>
  const rawEvents = Array.isArray(objectValue.events)
    ? objectValue.events
    : (Array.isArray(objectValue.data) ? objectValue.data : [])

  const events: SessionBridgeEvent[] = []

  for (const entry of rawEvents) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }

    const objectEntry = entry as Record<string, unknown>
    const id = parseSessionId(objectEntry.id)
    const type = parseSessionId(objectEntry.type) || 'message'
    if (!id) {
      continue
    }

    events.push({
      id,
      type,
      payload: objectEntry.payload
    })
  }

  const cursor = parseSessionId(objectValue.cursor)

  return {
    sessionId: parseSessionId(objectValue.sessionId) || fallbackSessionId,
    events,
    cursor
  }
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
          'content-type': 'application/json',
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
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

      return JSON.parse(text) as unknown
    } finally {
      clearTimeout(timeout)
    }
  }

  async function requestWithPaths(
    paths: string[],
    requestOptions: RequestOptions,
    sessionId?: string
  ): Promise<unknown> {
    let lastError: unknown = null

    for (const path of paths) {
      const normalizedPath = normalizePath(path, sessionId)
      try {
        return await request(normalizedPath, requestOptions)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error('No request paths available')
  }

  async function listSessions(): Promise<OpenCodeSessionSummary[]> {
    const payload = await requestWithPaths(LIST_SESSION_PATHS, {
      method: 'GET'
    })

    return parseSessionCollection(payload)
  }

  async function createSession(): Promise<string> {
    const payload = await requestWithPaths(CREATE_SESSION_PATHS, {
      method: 'POST',
      body: {
        workspacePath: options.repoPath
      }
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

      const payload = await requestWithPaths(MESSAGE_PATHS, {
        method: 'POST',
        body: {
          role: input.role,
          content: input.content
        }
      }, activeSessionId)

      return parseMessageResult(payload, activeSessionId)
    },
    fetchEvents: async (cursor?: string | null): Promise<SessionBridgeEventsResult> => {
      if (!activeSessionId) {
        throw new Error('Session bridge has no active session id')
      }

      const eventPaths = EVENTS_PATHS.map((path) => {
        return cursor
          ? `${path}?cursor=${encodeURIComponent(cursor)}`
          : path
      })

      const payload = await requestWithPaths(
        eventPaths,
        {
          method: 'GET'
        },
        activeSessionId
      )

      return parseEventsResult(payload, activeSessionId)
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
