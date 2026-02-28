import type {
  RuntimeInfo,
  RuntimeHostState,
  LauncherHostState,
  LauncherResolvedContext,
  HostCapabilityFlag,
  OpenCodeEngineStatus,
  SessionBridgeStatus,
  TerminalBridgeStatus
} from '~/types/launcher'

function createDefaultHostState(): RuntimeHostState {
  return {
    mode: 'web',
    launcher: null
  }
}

function createDefaultRuntimeInfo(): RuntimeInfo {
  return {
    host: createDefaultHostState()
  }
}

function createDefaultEngineStatus(): OpenCodeEngineStatus {
  return {
    state: 'stopped',
    endpoint: null,
    reused: false,
    owned: false,
    pid: null,
    instanceKey: null,
    connectionMode: 'unavailable',
    checkedAt: new Date(0).toISOString(),
    message: 'OpenCode lifecycle manager is not active in this runtime mode.',
    diagnostics: []
  }
}

function createDefaultSessionStatus(): SessionBridgeStatus {
  return {
    state: 'disabled',
    activeSessionId: null,
    source: 'none',
    workspaceKey: 'unbound',
    endpoint: null,
    lastResolvedAt: new Date(0).toISOString(),
    message: 'Session bridge is not active in this runtime mode.',
    diagnostics: []
  }
}

function createDefaultTerminalStatus(): TerminalBridgeStatus {
  return {
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
    message: 'libghostty terminal bridge is not active in this runtime mode.',
    diagnostics: []
  }
}

export function useHostRuntime() {
  const { data, status, error, refresh } = useFetch<RuntimeInfo>('/api/runtime', {
    key: 'host-runtime',
    default: () => createDefaultRuntimeInfo(),
    server: false
  })

  const runtime = computed(() => data.value || createDefaultRuntimeInfo())
  const hostState = computed<RuntimeHostState>(() => runtime.value.host || createDefaultHostState())
  const hostMode = computed(() => hostState.value.mode)
  const launcherState = computed<LauncherHostState | null>(() => {
    if (hostState.value.mode !== 'launcher') {
      return null
    }

    return hostState.value.launcher || null
  })

  const hostContext = computed<LauncherResolvedContext | null>(() => launcherState.value?.context || null)
  const engineStatus = computed<OpenCodeEngineStatus>(() => launcherState.value?.engine || createDefaultEngineStatus())
  const sessionStatus = computed<SessionBridgeStatus>(() => launcherState.value?.session || createDefaultSessionStatus())
  const terminalStatus = computed<TerminalBridgeStatus>(() => launcherState.value?.terminal || createDefaultTerminalStatus())
  const capabilities = computed<HostCapabilityFlag[]>(() => launcherState.value?.capabilities || [])
  const unavailableCapabilities = computed<HostCapabilityFlag[]>(() => {
    return capabilities.value.filter((capability) => !capability.available)
  })
  const warnings = computed<string[]>(() => launcherState.value?.warnings || [])

  return {
    runtime,
    hostState,
    hostMode,
    launcherState,
    hostContext,
    engineStatus,
    sessionStatus,
    terminalStatus,
    capabilities,
    unavailableCapabilities,
    warnings,
    status,
    error,
    refresh
  }
}
