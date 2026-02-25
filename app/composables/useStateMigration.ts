type MigrationState = 'idle' | 'running' | 'completed' | 'failed'

export type StateMigrationStatus = {
  state: MigrationState
  version: string
  startedAt: string | null
  completedAt: string | null
  totalRows: number
  processedRows: number
  migratedRows: number
  failedRows: number
  currentSlug: string | null
  errorMessage: string | null
  percent: number
}

const STATUS_POLL_INTERVAL_MS = 700

const defaultStatus: StateMigrationStatus = {
  state: 'idle',
  version: 'progress-json-v2',
  startedAt: null,
  completedAt: null,
  totalRows: 0,
  processedRows: 0,
  migratedRows: 0,
  failedRows: 0,
  currentSlug: null,
  errorMessage: null,
  percent: 0
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let subscriberCount = 0

export function useStateMigration() {
  const status = useState<StateMigrationStatus>('state-migration:status', () => ({ ...defaultStatus }))
  const initialized = useState<boolean>('state-migration:initialized', () => false)

  const isBlocking = computed(() => status.value.state === 'running' || status.value.state === 'failed')

  async function refreshStatus(): Promise<void> {
    if (!import.meta.client || inFlight) {
      return
    }

    inFlight = true

    try {
      const latest = await $fetch<StateMigrationStatus>('/api/state-migration/status', {
        query: { _: Date.now() }
      })

      status.value = latest
      initialized.value = true

      if (latest.state === 'completed') {
        stopPolling()
      }
    } catch {
      initialized.value = true
    } finally {
      inFlight = false
    }
  }

  function startPolling() {
    if (!import.meta.client || pollTimer) {
      return
    }

    pollTimer = setInterval(() => {
      refreshStatus()
    }, STATUS_POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (!pollTimer) {
      return
    }

    clearInterval(pollTimer)
    pollTimer = null
  }

  onMounted(() => {
    subscriberCount += 1
    void refreshStatus()
    startPolling()
  })

  onUnmounted(() => {
    subscriberCount = Math.max(0, subscriberCount - 1)
    if (subscriberCount === 0) {
      stopPolling()
    }
  })

  return {
    status,
    initialized,
    isBlocking,
    refreshStatus
  }
}
