import { randomUUID } from 'node:crypto'
import type {
  HostBoundaryContract,
  HostCapabilityFlag,
  HostCapabilityId,
  LauncherHostState,
  LauncherResolvedContext,
  OpenCodeEngineState,
  OpenCodeEngineStatus,
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
  const contract = parseContract(value.contract)

  return {
    context,
    engine,
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
