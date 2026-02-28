import { randomUUID } from 'node:crypto'
import type {
  HostBoundaryContract,
  HostCapabilityFlag,
  HostCapabilityId,
  LauncherHostState,
  LauncherResolvedContext,
  RuntimeHostState
} from '~~/app/types/launcher'

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

const DEFAULT_HOST_CONTRACT: HostBoundaryContract = {
  host: [],
  ui: []
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
  const contract = parseContract(value.contract)

  return {
    context,
    capabilities,
    warnings,
    contract
  }
}

function resolveHostRuntimeState(): RuntimeHostState {
  const runtimeMode = process.env.STEWARD_RUNTIME_MODE === 'launcher' ? 'launcher' : 'web'

  if (runtimeMode !== 'launcher') {
    return {
      mode: 'web',
      launcher: null
    }
  }

  const launcherPayload = parseLauncherPayload(parseJsonPayload(process.env.STEWARD_LAUNCHER_PAYLOAD_JSON))

  return {
    mode: 'launcher',
    launcher: launcherPayload
  }
}

export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)

  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate')

  return {
    buildId: runtimeConfig.app.buildId,
    instanceId: SERVER_INSTANCE_ID,
    startedAt: SERVER_STARTED_AT,
    host: resolveHostRuntimeState()
  }
})
