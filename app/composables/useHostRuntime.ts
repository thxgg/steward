import type { RuntimeInfo, RuntimeHostState, LauncherHostState, LauncherResolvedContext, HostCapabilityFlag } from '~/types/launcher'

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
    capabilities,
    unavailableCapabilities,
    warnings,
    status,
    error,
    refresh
  }
}
