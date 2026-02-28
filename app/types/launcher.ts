/**
 * Runtime mode exposed by the host process
 */
export type HostRuntimeMode = 'web' | 'launcher'

/**
 * Supported launcher control actions
 */
export type LauncherControlAction = 'retry' | 'reconnect' | 'restart'

/**
 * Launcher error classification surfaced to UI
 */
export type LauncherUiErrorKind = 'process' | 'auth' | 'network'

/**
 * Normalized launcher UI error payload
 */
export interface LauncherUiError {
  /** Error class used for UX treatment */
  kind: LauncherUiErrorKind
  /** Stable error code for programmatic handling */
  code: string
  /** User-facing error summary */
  message: string
}

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
 * OpenCode engine lifecycle state
 */
export type OpenCodeEngineState = 'starting' | 'healthy' | 'degraded' | 'stopped'

/**
 * Lifecycle and health status for OpenCode engine runtime
 */
export interface OpenCodeEngineStatus {
  /** Current lifecycle state */
  state: OpenCodeEngineState
  /** Engine endpoint currently targeted by launcher */
  endpoint: string | null
  /** Whether this launch reused an existing endpoint */
  reused: boolean
  /** Whether launcher currently owns a spawned engine process */
  owned: boolean
  /** PID of owned process when available */
  pid: number | null
  /** Last health/status check timestamp */
  checkedAt: string
  /** Human-readable lifecycle status summary */
  message: string
  /** Diagnostic breadcrumbs for degraded behavior */
  diagnostics: string[]
}

/**
 * Active-session selection source
 */
export type SessionSelectionSource = 'explicit' | 'persisted' | 'created' | 'none'

/**
 * Session bridge lifecycle state
 */
export type SessionBridgeState = 'ready' | 'degraded' | 'disabled'

/**
 * Active OpenCode session bridge status
 */
export interface SessionBridgeStatus {
  /** Session bridge readiness state */
  state: SessionBridgeState
  /** Active OpenCode session identifier */
  activeSessionId: string | null
  /** How active session was selected */
  source: SessionSelectionSource
  /** Deterministic workspace key used for persistence */
  workspaceKey: string
  /** Endpoint used for bridge traffic */
  endpoint: string | null
  /** Last session resolution timestamp */
  lastResolvedAt: string
  /** Human-readable status summary */
  message: string
  /** Diagnostic breadcrumbs for degraded behavior */
  diagnostics: string[]
}

/**
 * Session-bridge outbound message payload
 */
export interface SessionBridgeMessageInput {
  /** Message role */
  role: 'user' | 'assistant' | 'system'
  /** Message content */
  content: string
}

/**
 * Result returned when sending a bridge message
 */
export interface SessionBridgeMessageResult {
  /** Active session used by bridge */
  sessionId: string
  /** Whether endpoint accepted message */
  accepted: boolean
  /** Optional request identifier from bridge transport */
  requestId: string | null
}

/**
 * Event payload returned from session bridge
 */
export interface SessionBridgeEvent {
  /** Event id from OpenCode stream */
  id: string
  /** Event type/category */
  type: string
  /** Opaque event payload */
  payload?: unknown
}

/**
 * Result returned when polling bridge events
 */
export interface SessionBridgeEventsResult {
  /** Active session used by bridge */
  sessionId: string
  /** Event batch */
  events: SessionBridgeEvent[]
  /** Cursor for subsequent polling */
  cursor: string | null
}

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
  /** OpenCode engine lifecycle status */
  engine: OpenCodeEngineStatus
  /** Active OpenCode session bridge status */
  session: SessionBridgeStatus
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
