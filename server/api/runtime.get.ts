import { randomUUID } from 'node:crypto'
import type {
  HostBoundaryContract,
  HostCapabilityFlag,
  HostCapabilityId,
  LauncherHostState,
  LauncherResolvedContext,
  OpenCodeEngineState,
  OpenCodeEngineStatus,
  SessionBridgeState,
  SessionBridgeStatus,
  SessionSelectionSource,
  TerminalBridgeState,
  TerminalBridgeStatus,
  RuntimeHostState
} from '~~/app/types/launcher'
import { fetchLauncherRuntimeState, toLauncherUiError } from '~~/server/utils/launcher-control'

const SERVER_INSTANCE_ID = randomUUID()
const SERVER_STARTED_AT = new Date().toISOString()

const VALID_CAPABILITY_IDS = new Set<HostCapabilityId>([
  'workspaceContext',
  'opencodeCli',
  'engineLifecycle',
  'sessionBridge',
  'workflowActions',
  'terminalEmbedding'
])

const VALID_ENGINE_STATES = new Set<OpenCodeEngineState>([
  'starting',
  'healthy',
  'degraded',
  'stopped'
])

const VALID_SESSION_BRIDGE_STATES = new Set<SessionBridgeState>([
  'ready',
  'degraded',
  'disabled'
])

const VALID_SESSION_SOURCES = new Set<SessionSelectionSource>([
  'explicit',
  'persisted',
  'created',
  'none'
])

const VALID_TERMINAL_STATES = new Set<TerminalBridgeState>([
  'attached',
  'detached',
  'degraded',
  'disabled'
])

const DEFAULT_HOST_CONTRACT: HostBoundaryContract = {
  host: [],
  ui: []
}

const DEFAULT_ENGINE_STATUS: OpenCodeEngineStatus = {
  state: 'stopped',
  endpoint: null,
  reused: false,
  owned: false,
  pid: null,
  checkedAt: new Date(0).toISOString(),
  message: 'OpenCode lifecycle status is unavailable in this runtime.',
  diagnostics: []
}

const DEFAULT_SESSION_STATUS: SessionBridgeStatus = {
  state: 'disabled',
  activeSessionId: null,
  source: 'none',
  workspaceKey: 'unbound',
  endpoint: null,
  lastResolvedAt: new Date(0).toISOString(),
  message: 'Session bridge status is unavailable in this runtime.',
  diagnostics: []
}

const DEFAULT_TERMINAL_STATUS: TerminalBridgeStatus = {
  renderer: 'libghostty',
  state: 'disabled',
  sessionId: null,
  activeSessionId: null,
  requiresReattach: false,
  rows: 24,
  cols: 80,
  scrollbackLimit: 1000,
  attachedAt: null,
  detachedAt: null,
  message: 'libghostty terminal status is unavailable in this runtime.',
  diagnostics: []
}

function parseJsonPayload(rawValue: string | undefined): unknown {
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function parseContext(value: unknown): LauncherResolvedContext | null {
  if (!isRecord(value)) {
    return null
  }

  const repoId = typeof value.repoId === 'string' ? value.repoId.trim() : ''
  const repoName = typeof value.repoName === 'string' ? value.repoName.trim() : ''
  const repoPath = typeof value.repoPath === 'string' ? value.repoPath.trim() : ''
  const prdSlug = typeof value.prdSlug === 'string' && value.prdSlug.trim().length > 0
    ? value.prdSlug.trim()
    : null
  const prdSource = typeof value.prdSource === 'string' ? value.prdSource : 'none'

  if (!repoId || !repoName || !repoPath) {
    return null
  }

  if (prdSource !== 'explicit'
    && prdSource !== 'actionable'
    && prdSource !== 'stateful'
    && prdSource !== 'latest'
    && prdSource !== 'none') {
    return null
  }

  return {
    repoId,
    repoName,
    repoPath,
    prdSlug,
    prdSource
  }
}

function parseCapability(value: unknown): HostCapabilityFlag | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id : ''
  if (!VALID_CAPABILITY_IDS.has(id as HostCapabilityId)) {
    return null
  }

  const label = typeof value.label === 'string' ? value.label.trim() : ''
  const available = typeof value.available === 'boolean' ? value.available : null
  const detail = typeof value.detail === 'string' ? value.detail.trim() : ''
  const action = typeof value.action === 'string' && value.action.trim().length > 0
    ? value.action.trim()
    : undefined

  if (!label || available === null || !detail) {
    return null
  }

  return {
    id: id as HostCapabilityId,
    label,
    available,
    detail,
    ...(action && { action })
  }
}

function parseContract(value: unknown): HostBoundaryContract {
  if (!isRecord(value)) {
    return DEFAULT_HOST_CONTRACT
  }

  return {
    host: toStringArray(value.host),
    ui: toStringArray(value.ui)
  }
}

function parseEngineStatus(value: unknown): OpenCodeEngineStatus {
  if (!isRecord(value)) {
    return DEFAULT_ENGINE_STATUS
  }

  const state = typeof value.state === 'string' && VALID_ENGINE_STATES.has(value.state as OpenCodeEngineState)
    ? value.state as OpenCodeEngineState
    : DEFAULT_ENGINE_STATUS.state
  const endpoint = typeof value.endpoint === 'string' && value.endpoint.trim().length > 0
    ? value.endpoint.trim()
    : null
  const reused = typeof value.reused === 'boolean' ? value.reused : false
  const owned = typeof value.owned === 'boolean' ? value.owned : false
  const pid = typeof value.pid === 'number' && Number.isFinite(value.pid) ? value.pid : null
  const checkedAt = typeof value.checkedAt === 'string' && value.checkedAt.trim().length > 0
    ? value.checkedAt.trim()
    : new Date().toISOString()
  const message = typeof value.message === 'string' && value.message.trim().length > 0
    ? value.message.trim()
    : DEFAULT_ENGINE_STATUS.message
  const diagnostics = toStringArray(value.diagnostics)

  return {
    state,
    endpoint,
    reused,
    owned,
    pid,
    checkedAt,
    message,
    diagnostics
  }
}

function parseSessionStatus(value: unknown): SessionBridgeStatus {
  if (!isRecord(value)) {
    return DEFAULT_SESSION_STATUS
  }

  const state = typeof value.state === 'string' && VALID_SESSION_BRIDGE_STATES.has(value.state as SessionBridgeState)
    ? value.state as SessionBridgeState
    : DEFAULT_SESSION_STATUS.state
  const activeSessionId = typeof value.activeSessionId === 'string' && value.activeSessionId.trim().length > 0
    ? value.activeSessionId.trim()
    : null
  const source = typeof value.source === 'string' && VALID_SESSION_SOURCES.has(value.source as SessionSelectionSource)
    ? value.source as SessionSelectionSource
    : DEFAULT_SESSION_STATUS.source
  const workspaceKey = typeof value.workspaceKey === 'string' && value.workspaceKey.trim().length > 0
    ? value.workspaceKey.trim()
    : DEFAULT_SESSION_STATUS.workspaceKey
  const endpoint = typeof value.endpoint === 'string' && value.endpoint.trim().length > 0
    ? value.endpoint.trim()
    : null
  const lastResolvedAt = typeof value.lastResolvedAt === 'string' && value.lastResolvedAt.trim().length > 0
    ? value.lastResolvedAt.trim()
    : new Date().toISOString()
  const message = typeof value.message === 'string' && value.message.trim().length > 0
    ? value.message.trim()
    : DEFAULT_SESSION_STATUS.message
  const diagnostics = toStringArray(value.diagnostics)

  return {
    state,
    activeSessionId,
    source,
    workspaceKey,
    endpoint,
    lastResolvedAt,
    message,
    diagnostics
  }
}

function parseTerminalStatus(value: unknown): TerminalBridgeStatus {
  if (!isRecord(value)) {
    return DEFAULT_TERMINAL_STATUS
  }

  const state = typeof value.state === 'string' && VALID_TERMINAL_STATES.has(value.state as TerminalBridgeState)
    ? value.state as TerminalBridgeState
    : DEFAULT_TERMINAL_STATUS.state
  const sessionId = typeof value.sessionId === 'string' && value.sessionId.trim().length > 0
    ? value.sessionId.trim()
    : null
  const activeSessionId = typeof value.activeSessionId === 'string' && value.activeSessionId.trim().length > 0
    ? value.activeSessionId.trim()
    : null
  const requiresReattach = typeof value.requiresReattach === 'boolean'
    ? value.requiresReattach
    : false
  const rows = typeof value.rows === 'number' && Number.isFinite(value.rows) && value.rows > 0
    ? Math.floor(value.rows)
    : DEFAULT_TERMINAL_STATUS.rows
  const cols = typeof value.cols === 'number' && Number.isFinite(value.cols) && value.cols > 0
    ? Math.floor(value.cols)
    : DEFAULT_TERMINAL_STATUS.cols
  const scrollbackLimit = typeof value.scrollbackLimit === 'number'
    && Number.isFinite(value.scrollbackLimit)
    && value.scrollbackLimit > 0
    ? Math.floor(value.scrollbackLimit)
    : DEFAULT_TERMINAL_STATUS.scrollbackLimit
  const attachedAt = typeof value.attachedAt === 'string' && value.attachedAt.trim().length > 0
    ? value.attachedAt.trim()
    : null
  const detachedAt = typeof value.detachedAt === 'string' && value.detachedAt.trim().length > 0
    ? value.detachedAt.trim()
    : null
  const message = typeof value.message === 'string' && value.message.trim().length > 0
    ? value.message.trim()
    : DEFAULT_TERMINAL_STATUS.message
  const diagnostics = toStringArray(value.diagnostics)

  return {
    renderer: 'libghostty',
    state,
    sessionId,
    activeSessionId,
    requiresReattach,
    rows,
    cols,
    scrollbackLimit,
    attachedAt,
    detachedAt,
    message,
    diagnostics
  }
}

function parseLauncherPayload(value: unknown): LauncherHostState | null {
  if (!isRecord(value)) {
    return null
  }

  const capabilitiesRaw = Array.isArray(value.capabilities) ? value.capabilities : []
  const capabilities = capabilitiesRaw
    .map(parseCapability)
    .filter((entry): entry is HostCapabilityFlag => entry !== null)

  const warnings = toStringArray(value.warnings)
  const context = parseContext(value.context)
  const engine = parseEngineStatus(value.engine)
  const session = parseSessionStatus(value.session)
  const terminal = parseTerminalStatus(value.terminal)
  const contract = parseContract(value.contract)

  return {
    context,
    engine,
    session,
    terminal,
    capabilities,
    warnings,
    contract
  }
}

function withControlWarning(
  launcherPayload: LauncherHostState | null,
  warningMessage: string
): LauncherHostState {
  if (!launcherPayload) {
    return {
      context: null,
      engine: {
        ...DEFAULT_ENGINE_STATUS,
        state: 'degraded',
        checkedAt: new Date().toISOString(),
        message: warningMessage,
        diagnostics: []
      },
      session: {
        ...DEFAULT_SESSION_STATUS,
        state: 'degraded',
        lastResolvedAt: new Date().toISOString(),
        message: warningMessage,
        diagnostics: []
      },
      terminal: {
        ...DEFAULT_TERMINAL_STATUS,
        state: 'degraded',
        message: warningMessage,
        diagnostics: []
      },
      capabilities: [],
      warnings: [warningMessage],
      contract: DEFAULT_HOST_CONTRACT
    }
  }

  return {
    ...launcherPayload,
    warnings: [...new Set([...launcherPayload.warnings, warningMessage])],
    engine: launcherPayload.engine.state === 'degraded'
      ? launcherPayload.engine
      : {
          ...launcherPayload.engine,
          state: 'degraded',
          checkedAt: new Date().toISOString(),
          message: warningMessage
        },
    session: launcherPayload.session.state === 'degraded'
      ? launcherPayload.session
      : {
          ...launcherPayload.session,
          state: 'degraded',
          lastResolvedAt: new Date().toISOString(),
          message: warningMessage
        },
    terminal: launcherPayload.terminal.state === 'degraded'
      ? launcherPayload.terminal
      : {
          ...launcherPayload.terminal,
          state: 'degraded',
          message: warningMessage
        }
  }
}

async function resolveHostRuntimeState(): Promise<RuntimeHostState> {
  const runtimeMode = process.env.STEWARD_RUNTIME_MODE === 'launcher' ? 'launcher' : 'web'

  if (runtimeMode !== 'launcher') {
    return {
      mode: 'web',
      launcher: null
    }
  }

  const fallbackLauncherPayload = parseLauncherPayload(parseJsonPayload(process.env.STEWARD_LAUNCHER_PAYLOAD_JSON))

  try {
    return await fetchLauncherRuntimeState()
  } catch (error) {
    const normalized = toLauncherUiError(error)
    const warning = `Launcher control unavailable (${normalized.code}): ${normalized.message}`

    return {
      mode: 'launcher',
      launcher: withControlWarning(fallbackLauncherPayload, warning)
    }
  }
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)

  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate')

  return {
    buildId: runtimeConfig.app.buildId,
    instanceId: SERVER_INSTANCE_ID,
    startedAt: SERVER_STARTED_AT,
    host: await resolveHostRuntimeState()
  }
})
