type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink' | 'connected'
  path?: string
  repoId?: string
  category?: 'prd' | 'tasks' | 'progress'
}

type RuntimeInfo = {
  buildId?: string
  instanceId?: string
  startedAt?: string
}

type FileWatchCallback = (event: FileChangeEvent) => void

const RECONNECT_DELAY_MS = 2000
const RUNTIME_PROBE_INTERVAL_MS = 2000

function toRuntimeToken(runtime: RuntimeInfo): string | null {
  if (!runtime.instanceId || !runtime.buildId) {
    return null
  }

  return `${runtime.buildId}:${runtime.instanceId}`
}

export function useFileWatch(callback: FileWatchCallback) {
  const eventSource = ref<EventSource | null>(null)
  const isConnected = ref(false)
  const error = ref<string | null>(null)

  const reconnectTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const runtimeProbeTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const runtimeToken = ref<string | null>(null)
  const runtimeCheckInFlight = ref(false)
  const shouldCheckRuntimeOnReconnect = ref(false)
  const reloadTriggered = ref(false)

  function clearReconnectTimer() {
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }
  }

  function stopRuntimeProbe() {
    if (runtimeProbeTimer.value) {
      clearInterval(runtimeProbeTimer.value)
      runtimeProbeTimer.value = null
    }
  }

  async function fetchRuntimeToken(): Promise<string | null> {
    if (!import.meta.client) {
      return null
    }

    try {
      const runtime = await $fetch<RuntimeInfo>(`/api/runtime?_=${Date.now()}`)
      return toRuntimeToken(runtime)
    } catch {
      return null
    }
  }

  async function ensureRuntimeTokenInitialized() {
    if (runtimeToken.value !== null || !import.meta.client) {
      return
    }

    runtimeToken.value = await fetchRuntimeToken()
  }

  async function checkRuntimeAndReload() {
    if (!import.meta.client || runtimeCheckInFlight.value || reloadTriggered.value) {
      return
    }

    runtimeCheckInFlight.value = true

    try {
      const latestToken = await fetchRuntimeToken()
      if (!latestToken) {
        return
      }

      if (!runtimeToken.value) {
        runtimeToken.value = latestToken
        return
      }

      if (latestToken !== runtimeToken.value) {
        reloadTriggered.value = true
        window.location.reload()
      }
    } finally {
      runtimeCheckInFlight.value = false
    }
  }

  function startRuntimeProbe() {
    if (!import.meta.client || runtimeProbeTimer.value) {
      return
    }

    runtimeProbeTimer.value = setInterval(() => {
      checkRuntimeAndReload()
    }, RUNTIME_PROBE_INTERVAL_MS)
  }

  function scheduleReconnect() {
    if (!import.meta.client || reconnectTimer.value) {
      return
    }

    reconnectTimer.value = setTimeout(() => {
      reconnectTimer.value = null
      connect()
    }, RECONNECT_DELAY_MS)
  }

  function getWatchUrl(): string {
    if (!import.meta.client) {
      return '/api/watch'
    }

    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      return '/api/watch'
    }

    return `/api/watch?token=${encodeURIComponent(token)}`
  }

  function connect() {
    if (!import.meta.client || eventSource.value) return

    try {
      const es = new EventSource(getWatchUrl())

      es.onopen = async () => {
        isConnected.value = true
        error.value = null
        clearReconnectTimer()
        stopRuntimeProbe()

        if (shouldCheckRuntimeOnReconnect.value) {
          shouldCheckRuntimeOnReconnect.value = false
          await checkRuntimeAndReload()
        }
      }

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as FileChangeEvent
          callback(event)
        } catch {
          // Ignore malformed events
        }
      }

      es.onerror = () => {
        isConnected.value = false
        error.value = 'Connection lost'
        shouldCheckRuntimeOnReconnect.value = true

        if (eventSource.value === es) {
          es.close()
          eventSource.value = null
        }

        startRuntimeProbe()
        scheduleReconnect()
      }

      eventSource.value = es
    } catch {
      error.value = 'Failed to connect'
      startRuntimeProbe()
      scheduleReconnect()
    }
  }

  function disconnect() {
    clearReconnectTimer()
    stopRuntimeProbe()
    shouldCheckRuntimeOnReconnect.value = false

    if (eventSource.value) {
      eventSource.value.close()
      eventSource.value = null
      isConnected.value = false
    }
  }

  // Auto-connect on mount, disconnect on unmount
  onMounted(async () => {
    await ensureRuntimeTokenInitialized()
    connect()
  })

  onUnmounted(() => {
    disconnect()
  })

  return {
    isConnected,
    error,
    connect,
    disconnect
  }
}
