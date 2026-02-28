import type {
  LauncherUiError,
  LauncherUiErrorKind,
  TerminalAttachResult,
  TerminalBridgeStatus,
  TerminalDetachResult,
  TerminalInputResult,
  TerminalOutputEvent,
  TerminalOutputResult,
  TerminalResizeResult
} from '~/types/launcher'

const OUTPUT_POLL_INTERVAL_MS = 750

interface TerminalRuntimeState {
  connecting: boolean
  sending: boolean
  resizing: boolean
  lastError: LauncherUiError | null
  outputCursor: string | null
  sessionBinding: string | null
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

function createRuntimeState(): TerminalRuntimeState {
  return {
    connecting: false,
    sending: false,
    resizing: false,
    lastError: null,
    outputCursor: null,
    sessionBinding: null
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

  const inferredKind: LauncherUiErrorKind = fetchError.statusCode === 401 || fetchError.statusCode === 403
    ? 'auth'
    : fetchError.statusCode === 503
      ? 'network'
      : 'process'

  return {
    kind: fetchError.data?.kind !== undefined
      ? normalizeErrorKind(fetchError.data.kind)
      : inferredKind,
    code: typeof fetchError.data?.code === 'string' && fetchError.data.code.trim().length > 0
      ? fetchError.data.code.trim()
      : 'LAUNCHER_TERMINAL_ERROR',
    message: typeof fetchError.data?.message === 'string' && fetchError.data.message.trim().length > 0
      ? fetchError.data.message.trim()
      : (fetchError.statusMessage || fetchError.message || 'Terminal request failed.')
  }
}

export function useLauncherTerminal() {
  const { hostMode, terminalStatus: runtimeTerminalStatus } = useHostRuntime()

  const terminal = useState<TerminalBridgeStatus>('launcher-terminal-status', () => createDefaultTerminalStatus())
  const outputEvents = useState<TerminalOutputEvent[]>('launcher-terminal-output-events', () => [])
  const draftInput = useState<string>('launcher-terminal-draft-input', () => '')
  const runtime = useState<TerminalRuntimeState>('launcher-terminal-runtime', () => createRuntimeState())

  const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

  const isLauncherMode = computed(() => hostMode.value === 'launcher')
  const isAttached = computed(() => terminal.value.state === 'attached')

  function appendOutput(events: TerminalOutputEvent[]) {
    if (events.length === 0) {
      return
    }

    const merged = [...outputEvents.value, ...events]
    const overflow = merged.length - terminal.value.scrollbackLimit
    outputEvents.value = overflow > 0 ? merged.slice(overflow) : merged
  }

  function setError(error: unknown) {
    runtime.value = {
      ...runtime.value,
      lastError: toUiError(error)
    }
  }

  function clearError() {
    runtime.value = {
      ...runtime.value,
      lastError: null
    }
  }

  async function syncState() {
    if (!isLauncherMode.value) {
      terminal.value = createDefaultTerminalStatus()
      outputEvents.value = []
      runtime.value = createRuntimeState()
      return
    }

    try {
      const response = await $fetch<{ ok: boolean; terminal: TerminalBridgeStatus }>('/api/launcher/terminal')
      terminal.value = {
        ...response.terminal,
        diagnostics: [...response.terminal.diagnostics]
      }
      clearError()
    } catch (error) {
      setError(error)
    }
  }

  async function pollOutput() {
    if (!isLauncherMode.value || !isAttached.value) {
      return
    }

    try {
      const response = await $fetch<{ ok: boolean; result: TerminalOutputResult }>('/api/launcher/terminal/output', {
        query: runtime.value.outputCursor ? { cursor: runtime.value.outputCursor } : undefined
      })

      terminal.value = {
        ...response.result.terminal,
        diagnostics: [...response.result.terminal.diagnostics]
      }
      appendOutput(response.result.events)

      runtime.value = {
        ...runtime.value,
        outputCursor: response.result.cursor,
        sessionBinding: response.result.terminal.sessionId,
        lastError: null
      }
    } catch (error) {
      setError(error)
    }
  }

  function startPolling() {
    if (!import.meta.client || pollTimer.value || !isAttached.value) {
      return
    }

    pollTimer.value = setInterval(() => {
      void pollOutput()
    }, OUTPUT_POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (!pollTimer.value) {
      return
    }

    clearInterval(pollTimer.value)
    pollTimer.value = null
  }

  async function attach(rows?: number, cols?: number): Promise<void> {
    if (!isLauncherMode.value) {
      return
    }

    runtime.value = {
      ...runtime.value,
      connecting: true
    }

    try {
      const response = await $fetch<{ ok: boolean; result: TerminalAttachResult }>('/api/launcher/terminal/attach', {
        method: 'POST',
        body: {
          ...(rows ? { rows } : {}),
          ...(cols ? { cols } : {})
        }
      })

      terminal.value = {
        ...response.result.terminal,
        diagnostics: [...response.result.terminal.diagnostics]
      }

      runtime.value = {
        ...runtime.value,
        connecting: false,
        outputCursor: null,
        sessionBinding: response.result.terminal.sessionId,
        lastError: null
      }

      startPolling()
      await pollOutput()
    } catch (error) {
      runtime.value = {
        ...runtime.value,
        connecting: false
      }
      setError(error)
    }
  }

  async function detach(reason = 'ui detach'): Promise<void> {
    if (!isLauncherMode.value) {
      return
    }

    runtime.value = {
      ...runtime.value,
      connecting: true
    }

    try {
      const response = await $fetch<{ ok: boolean; result: TerminalDetachResult }>('/api/launcher/terminal/detach', {
        method: 'POST',
        body: {
          reason
        }
      })

      terminal.value = {
        ...response.result.terminal,
        diagnostics: [...response.result.terminal.diagnostics]
      }
      runtime.value = {
        ...runtime.value,
        connecting: false,
        lastError: null
      }
      stopPolling()
    } catch (error) {
      runtime.value = {
        ...runtime.value,
        connecting: false
      }
      setError(error)
    }
  }

  async function sendInput(input?: string): Promise<void> {
    if (!isLauncherMode.value || runtime.value.sending) {
      return
    }

    const content = (input ?? draftInput.value).trimEnd()
    if (content.length === 0) {
      return
    }

    runtime.value = {
      ...runtime.value,
      sending: true
    }

    try {
      const response = await $fetch<{ ok: boolean; result: TerminalInputResult }>('/api/launcher/terminal/input', {
        method: 'POST',
        body: {
          input: content
        }
      })

      terminal.value = {
        ...response.result.terminal,
        diagnostics: [...response.result.terminal.diagnostics]
      }

      draftInput.value = ''
      runtime.value = {
        ...runtime.value,
        sending: false,
        lastError: null
      }

      await pollOutput()
    } catch (error) {
      runtime.value = {
        ...runtime.value,
        sending: false
      }
      setError(error)
    }
  }

  async function resize(rows: number, cols: number): Promise<void> {
    if (!isLauncherMode.value || runtime.value.resizing) {
      return
    }

    runtime.value = {
      ...runtime.value,
      resizing: true
    }

    try {
      const response = await $fetch<{ ok: boolean; result: TerminalResizeResult }>('/api/launcher/terminal/resize', {
        method: 'POST',
        body: {
          rows,
          cols
        }
      })

      terminal.value = {
        ...response.result.terminal,
        diagnostics: [...response.result.terminal.diagnostics]
      }
      runtime.value = {
        ...runtime.value,
        resizing: false,
        lastError: null
      }
    } catch (error) {
      runtime.value = {
        ...runtime.value,
        resizing: false
      }
      setError(error)
    }
  }

  watch([isLauncherMode, () => runtimeTerminalStatus.value.state],
    async ([mode], [prevMode]) => {
      if (!mode) {
        stopPolling()
        terminal.value = createDefaultTerminalStatus()
        outputEvents.value = []
        runtime.value = createRuntimeState()
        return
      }

      await syncState()

      if (terminal.value.requiresReattach) {
        stopPolling()
        return
      }

      if (!prevMode && mode && terminal.value.state === 'detached') {
        await attach(terminal.value.rows, terminal.value.cols)
      }

      if (terminal.value.state === 'attached') {
        startPolling()
      } else {
        stopPolling()
      }
    },
    { immediate: true }
  )

  onMounted(async () => {
    await syncState()
    if (terminal.value.state === 'attached') {
      startPolling()
      await pollOutput()
    }
  })

  onUnmounted(() => {
    stopPolling()
  })

  return {
    terminal,
    outputEvents,
    draftInput,
    runtime,
    isLauncherMode,
    isAttached,
    attach,
    detach,
    sendInput,
    resize,
    pollOutput
  }
}
