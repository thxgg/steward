import type {
  LauncherControlAction,
  LauncherUiError,
  LauncherUiErrorKind,
  OpenCodeEngineStatus
} from '~/types/launcher'

type EngineConnectionState = 'idle' | 'syncing' | 'online' | 'error'

interface EngineConnectionMeta {
  state: EngineConnectionState
  lastSyncedAt: string | null
  inFlightAction: LauncherControlAction | null
  lastAction: LauncherControlAction | null
  lastActionAt: string | null
}

interface EngineLifecycleEvent {
  type: 'status' | 'action' | 'error'
  message: string
  timestamp: string
}

const POLL_INTERVAL_MS = 2_000
const MAX_EVENTS = 40

function createFallbackStatus(): OpenCodeEngineStatus {
  return {
    state: 'stopped',
    endpoint: null,
    reused: false,
    owned: false,
    pid: null,
    instanceKey: null,
    connectionMode: 'unavailable',
    bindingMode: 'unavailable',
    authMode: 'none',
    checkedAt: new Date(0).toISOString(),
    message: 'OpenCode lifecycle manager is not active in this runtime mode.',
    diagnostics: []
  }
}

function createConnectionMeta(): EngineConnectionMeta {
  return {
    state: 'idle',
    lastSyncedAt: null,
    inFlightAction: null,
    lastAction: null,
    lastActionAt: null
  }
}

function normalizeErrorKind(value: unknown): LauncherUiErrorKind {
  if (value === 'auth' || value === 'network' || value === 'process') {
    return value
  }

  return 'process'
}

function toUiError(error: unknown): LauncherUiError {
  const fetchError = error as {
    statusCode?: number
    data?: {
      kind?: unknown
      code?: unknown
      message?: unknown
    }
    statusMessage?: string
    message?: string
  }

  const statusCode = fetchError.statusCode
  const inferredKind: LauncherUiErrorKind = statusCode === 401 || statusCode === 403
    ? 'auth'
    : statusCode === 503
      ? 'network'
      : 'process'

  const kind = fetchError.data?.kind !== undefined
    ? normalizeErrorKind(fetchError.data.kind)
    : inferredKind
  const code = typeof fetchError.data?.code === 'string' && fetchError.data.code.trim().length > 0
    ? fetchError.data.code.trim()
    : 'LAUNCHER_UI_ERROR'
  const message = typeof fetchError.data?.message === 'string' && fetchError.data.message.trim().length > 0
    ? fetchError.data.message.trim()
    : (fetchError.statusMessage || fetchError.message || 'Launcher request failed.')

  return {
    kind,
    code,
    message
  }
}

export function useEngineLifecycle() {
  const { hostMode, launcherState, engineStatus: hostEngineStatus, refresh: refreshHostRuntime } = useHostRuntime()

  const status = useState<OpenCodeEngineStatus>('launcher-engine-lifecycle-status', () => createFallbackStatus())
  const connection = useState<EngineConnectionMeta>('launcher-engine-lifecycle-connection', () => createConnectionMeta())
  const lastError = useState<LauncherUiError | null>('launcher-engine-lifecycle-error', () => null)
  const events = useState<EngineLifecycleEvent[]>('launcher-engine-lifecycle-events', () => [])

  const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

  const isLauncherMode = computed(() => hostMode.value === 'launcher')
  const isActionInFlight = computed(() => connection.value.inFlightAction !== null)

  function appendEvent(type: EngineLifecycleEvent['type'], message: string) {
    const entry: EngineLifecycleEvent = {
      type,
      message,
      timestamp: new Date().toISOString()
    }

    events.value = [...events.value, entry].slice(-MAX_EVENTS)
  }

  function syncFromHostRuntime() {
    const nextStatus = hostEngineStatus.value || createFallbackStatus()

    status.value = {
      ...nextStatus,
      diagnostics: [...nextStatus.diagnostics]
    }

    if (isLauncherMode.value) {
      connection.value = {
        ...connection.value,
        state: 'online',
        lastSyncedAt: new Date().toISOString()
      }
    } else {
      connection.value = createConnectionMeta()
      status.value = createFallbackStatus()
    }
  }

  async function refreshStatus() {
    if (!isLauncherMode.value) {
      syncFromHostRuntime()
      return
    }

    connection.value = {
      ...connection.value,
      state: 'syncing'
    }

    try {
      await refreshHostRuntime()
      syncFromHostRuntime()
      appendEvent('status', `Engine status synced: ${status.value.state}`)
      lastError.value = null
    } catch (error) {
      const mapped = toUiError(error)
      lastError.value = mapped
      connection.value = {
        ...connection.value,
        state: 'error'
      }
      appendEvent('error', `${mapped.code}: ${mapped.message}`)
    }
  }

  async function runAction(action: LauncherControlAction) {
    if (!isLauncherMode.value || connection.value.inFlightAction) {
      return
    }

    connection.value = {
      ...connection.value,
      inFlightAction: action,
      state: 'syncing'
    }
    appendEvent('action', `Requested action: ${action}`)

    try {
      const result = await $fetch<{ ok: boolean; host: { mode: string; launcher: { engine: OpenCodeEngineStatus } | null } }>('/api/launcher/engine', {
        method: 'POST',
        body: { action }
      })

      if (result.host.mode === 'launcher' && result.host.launcher?.engine) {
        const next = result.host.launcher.engine
        status.value = {
          ...next,
          diagnostics: [...next.diagnostics]
        }
      }

      connection.value = {
        ...connection.value,
        inFlightAction: null,
        lastAction: action,
        lastActionAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
        state: 'online'
      }
      lastError.value = null

      appendEvent('action', `Action completed: ${action}`)
      await refreshStatus()
    } catch (error) {
      const mapped = toUiError(error)
      lastError.value = mapped

      connection.value = {
        ...connection.value,
        inFlightAction: null,
        lastAction: action,
        lastActionAt: new Date().toISOString(),
        state: 'error'
      }

      appendEvent('error', `${mapped.code}: ${mapped.message}`)
    }
  }

  function startPolling() {
    if (!import.meta.client || pollTimer.value || !isLauncherMode.value) {
      return
    }

    pollTimer.value = setInterval(() => {
      void refreshStatus()
    }, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (!pollTimer.value) {
      return
    }

    clearInterval(pollTimer.value)
    pollTimer.value = null
  }

  watch([isLauncherMode, launcherState], () => {
    syncFromHostRuntime()

    if (isLauncherMode.value) {
      startPolling()
      return
    }

    stopPolling()
  }, { immediate: true })

  onMounted(() => {
    syncFromHostRuntime()
    startPolling()
  })

  onUnmounted(() => {
    stopPolling()
  })

  return {
    status,
    connection,
    lastError,
    events,
    isLauncherMode,
    isActionInFlight,
    refreshStatus,
    runAction
  }
}
