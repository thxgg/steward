import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

interface SessionStoreRecord {
  sessionId: string
  updatedAt: string
}

interface SessionStorePayload {
  version: 1
  workspaces: Record<string, SessionStoreRecord>
}

const SESSION_STORE_VERSION = 1

function defaultStorePath(): string {
  const dataHome = process.env.XDG_DATA_HOME
    ? resolve(process.env.XDG_DATA_HOME)
    : resolve(homedir(), '.local', 'share')

  return join(dataHome, 'steward', 'launcher-sessions.json')
}

function resolveStorePath(overridePath?: string): string {
  if (overridePath && overridePath.trim().length > 0) {
    return resolve(overridePath.trim())
  }

  if (process.env.STEWARD_LAUNCHER_SESSION_STORE_PATH?.trim()) {
    return resolve(process.env.STEWARD_LAUNCHER_SESSION_STORE_PATH.trim())
  }

  return defaultStorePath()
}

function createEmptyPayload(): SessionStorePayload {
  return {
    version: SESSION_STORE_VERSION,
    workspaces: {}
  }
}

function parsePayload(value: unknown): SessionStorePayload {
  if (!value || typeof value !== 'object') {
    return createEmptyPayload()
  }

  const candidate = value as {
    version?: unknown
    workspaces?: unknown
  }

  if (candidate.version !== SESSION_STORE_VERSION) {
    return createEmptyPayload()
  }

  if (!candidate.workspaces || typeof candidate.workspaces !== 'object' || Array.isArray(candidate.workspaces)) {
    return createEmptyPayload()
  }

  const normalized: Record<string, SessionStoreRecord> = {}

  for (const [workspaceKey, rawRecord] of Object.entries(candidate.workspaces)) {
    if (!workspaceKey || typeof rawRecord !== 'object' || rawRecord === null || Array.isArray(rawRecord)) {
      continue
    }

    const record = rawRecord as {
      sessionId?: unknown
      updatedAt?: unknown
    }

    if (typeof record.sessionId !== 'string' || record.sessionId.trim().length === 0) {
      continue
    }

    const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : new Date(0).toISOString()

    normalized[workspaceKey] = {
      sessionId: record.sessionId.trim(),
      updatedAt
    }
  }

  return {
    version: SESSION_STORE_VERSION,
    workspaces: normalized
  }
}

async function readStore(storePath: string): Promise<SessionStorePayload> {
  try {
    const raw = await fs.readFile(storePath, 'utf-8')
    return parsePayload(JSON.parse(raw) as unknown)
  } catch {
    return createEmptyPayload()
  }
}

async function writeStore(storePath: string, payload: SessionStorePayload): Promise<void> {
  await fs.mkdir(dirname(storePath), { recursive: true })
  await fs.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

export function createWorkspaceSessionKey(repoId: string, endpoint: string | null): string {
  const normalizedRepoId = repoId.trim() || 'unknown-repo'
  const normalizedEndpoint = endpoint && endpoint.trim().length > 0
    ? endpoint.trim().toLowerCase()
    : 'no-endpoint'

  return `${normalizedRepoId}::${normalizedEndpoint}`
}

export async function readPersistedSessionId(
  workspaceKey: string,
  options: { storePath?: string } = {}
): Promise<string | null> {
  const storePath = resolveStorePath(options.storePath)
  const store = await readStore(storePath)
  const record = store.workspaces[workspaceKey]

  return record?.sessionId || null
}

export async function persistSessionId(
  workspaceKey: string,
  sessionId: string,
  options: { storePath?: string } = {}
): Promise<void> {
  const storePath = resolveStorePath(options.storePath)
  const store = await readStore(storePath)

  store.workspaces[workspaceKey] = {
    sessionId,
    updatedAt: new Date().toISOString()
  }

  await writeStore(storePath, store)
}
