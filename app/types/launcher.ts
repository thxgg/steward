/**
 * Runtime mode exposed by the host process
 */
export type HostRuntimeMode = 'web' | 'launcher'

/**
 * Host capability identifiers surfaced to the UI
 */
export type HostCapabilityId =
  | 'workspaceContext'
  | 'opencodeCli'
  | 'engineLifecycle'
  | 'sessionBridge'
  | 'workflowActions'
  | 'terminalEmbedding'

/**
 * One capability flag from host -> UI handshake
 */
export interface HostCapabilityFlag {
  /** Stable capability identifier */
  id: HostCapabilityId
  /** Human-friendly capability name */
  label: string
  /** Whether this capability is currently available */
  available: boolean
  /** Current capability detail/status message */
  detail: string
  /** Optional action users can take when unavailable */
  action?: string
}

/**
 * How the launcher resolved initial PRD context
 */
export type LauncherPrdSource = 'explicit' | 'actionable' | 'stateful' | 'latest' | 'none'

/**
 * Resolved workspace context from desktop host bootstrap
 */
export interface LauncherResolvedContext {
  /** Registered repository id */
  repoId: string
  /** Repository display name */
  repoName: string
  /** Absolute repository path */
  repoPath: string
  /** Resolved PRD slug when available */
  prdSlug: string | null
  /** Source strategy used for PRD selection */
  prdSource: LauncherPrdSource
}

/**
 * Responsibility contract between desktop host and Nuxt UI
 */
export interface HostBoundaryContract {
  /** Host runtime responsibilities */
  host: string[]
  /** UI runtime responsibilities */
  ui: string[]
}

/**
 * Launcher-specific host handshake payload
 */
export interface LauncherHostState {
  /** Resolved repo/PRD context for this launch */
  context: LauncherResolvedContext | null
  /** Capability availability surfaced by host */
  capabilities: HostCapabilityFlag[]
  /** Non-fatal bootstrap warnings */
  warnings: string[]
  /** Explicit host/UI boundary responsibilities */
  contract: HostBoundaryContract
}

/**
 * Host runtime state returned from /api/runtime
 */
export interface RuntimeHostState {
  /** Current runtime mode */
  mode: HostRuntimeMode
  /** Launcher payload when in launcher mode */
  launcher: LauncherHostState | null
}

/**
 * Runtime metadata payload from /api/runtime
 */
export interface RuntimeInfo {
  /** Nuxt build id */
  buildId?: string
  /** Runtime process instance id */
  instanceId?: string
  /** Runtime process start timestamp */
  startedAt?: string
  /** Host mode/capability handshake */
  host: RuntimeHostState
}
