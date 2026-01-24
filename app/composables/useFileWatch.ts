type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink' | 'connected'
  path?: string
  repoId?: string
  category?: 'prd' | 'tasks' | 'progress'
}

type FileWatchCallback = (event: FileChangeEvent) => void

export function useFileWatch(callback: FileWatchCallback) {
  const eventSource = ref<EventSource | null>(null)
  const isConnected = ref(false)
  const error = ref<string | null>(null)

  function connect() {
    if (!import.meta.client) return
    if (eventSource.value) return // Already connected

    try {
      const es = new EventSource('/api/watch')

      es.onopen = () => {
        isConnected.value = true
        error.value = null
      }

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as FileChangeEvent
          callback(event)
        } catch {
          console.error('[useFileWatch] Failed to parse event:', e.data)
        }
      }

      es.onerror = () => {
        isConnected.value = false
        error.value = 'Connection lost'

        // Attempt reconnect after 5 seconds
        setTimeout(() => {
          if (eventSource.value === es) {
            eventSource.value = null
            connect()
          }
        }, 5000)
      }

      eventSource.value = es
    } catch (err) {
      error.value = 'Failed to connect'
      console.error('[useFileWatch] Failed to connect:', err)
    }
  }

  function disconnect() {
    if (eventSource.value) {
      eventSource.value.close()
      eventSource.value = null
      isConnected.value = false
    }
  }

  // Auto-connect on mount, disconnect on unmount
  onMounted(() => {
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
