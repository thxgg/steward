import type {
  SessionBridgeEventsResult,
  SessionBridgeMessageInput,
  SessionBridgeMessageResult,
  SessionBridgeStatus,
  TerminalAttachResult,
  TerminalBridgeStatus,
  TerminalDetachResult,
  TerminalInputResult,
  TerminalOutputChannel,
  TerminalOutputEvent,
  TerminalOutputResult,
  TerminalResizeResult
} from '../../../app/types/launcher.js'

const DEFAULT_TERMINAL_ROWS = 24
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_SCROLLBACK_LIMIT = 1000

export interface LauncherTerminalBridgeOptions {
  getSessionStatus: () => SessionBridgeStatus
  sendSessionMessage: (input: SessionBridgeMessageInput) => Promise<SessionBridgeMessageResult>
  fetchSessionEvents: (cursor?: string | null) => Promise<SessionBridgeEventsResult>
  rows?: number
  cols?: number
  scrollbackLimit?: number
}

export interface LauncherTerminalBridgeHandle {
  getStatus(): TerminalBridgeStatus
  attach(options?: { rows?: number; cols?: number }): Promise<TerminalAttachResult>
  detach(reason?: string): Promise<TerminalDetachResult>
  resize(rows: number, cols: number): Promise<TerminalResizeResult>
  sendInput(input: string): Promise<TerminalInputResult>
  fetchOutput(cursor?: string | null): Promise<TerminalOutputResult>
}

interface TerminalBufferEvent {
  seq: number
  event: TerminalOutputEvent
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizePositiveInt(value: number | undefined, fallbackValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallbackValue
  }

  return Math.floor(value)
}

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor || cursor.trim().length === 0) {
    return 0
  }

  const match = /^te_(\d+)$/.exec(cursor.trim())
  if (!match || !match[1]) {
    return 0
  }

  const parsed = Number.parseInt(match[1], 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return parsed
}

function formatEventPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload
  }

  if (payload === null || payload === undefined) {
    return ''
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function resolveSessionEventChannel(type: string): TerminalOutputChannel {
  const lower = type.toLowerCase()
  if (lower.includes('error') || lower.includes('stderr') || lower.includes('fail')) {
    return 'stderr'
  }

  return 'stdout'
}

export function createLauncherTerminalBridge(
  options: LauncherTerminalBridgeOptions
): LauncherTerminalBridgeHandle {
  const scrollbackLimit = normalizePositiveInt(options.scrollbackLimit, DEFAULT_SCROLLBACK_LIMIT)
  let rows = normalizePositiveInt(options.rows, DEFAULT_TERMINAL_ROWS)
  let cols = normalizePositiveInt(options.cols, DEFAULT_TERMINAL_COLS)

  let state: TerminalBridgeStatus['state'] = 'disabled'
  let sessionId: string | null = null
  let message = 'libghostty terminal bridge is waiting for an active session.'
  const diagnostics: string[] = []

  let attachedAt: string | null = null
  let detachedAt: string | null = null
  let seq = 0
  let sessionCursor: string | null = null
  let buffer: TerminalBufferEvent[] = []

  const getSnapshot = (): TerminalBridgeStatus => {
    return {
      renderer: 'libghostty',
      state,
      sessionId,
      rows,
      cols,
      scrollbackLimit,
      attachedAt,
      detachedAt,
      message,
      diagnostics: [...diagnostics]
    }
  }

  const pushEvent = (channel: TerminalOutputChannel, text: string): TerminalOutputEvent => {
    seq += 1
    const event: TerminalOutputEvent = {
      id: `te_${seq}`,
      channel,
      text,
      timestamp: nowIso()
    }

    buffer = [...buffer, { seq, event }]
    if (buffer.length > scrollbackLimit) {
      buffer = buffer.slice(buffer.length - scrollbackLimit)
    }

    return event
  }

  const pushDiagnostic = (text: string) => {
    const entry = text.trim()
    if (!entry) {
      return
    }

    diagnostics.push(entry)
    if (diagnostics.length > 20) {
      diagnostics.splice(0, diagnostics.length - 20)
    }
  }

  const resolveSessionBinding = (): SessionBridgeStatus => {
    const session = options.getSessionStatus()

    if (session.state !== 'ready' || !session.activeSessionId) {
      state = session.state === 'degraded' ? 'degraded' : 'disabled'
      sessionId = null
      message = session.message || 'libghostty terminal bridge is unavailable because session bridge is not ready.'
      return session
    }

    if (sessionId && sessionId !== session.activeSessionId) {
      pushEvent('system', `Session changed from ${sessionId} to ${session.activeSessionId}. Rebinding terminal.`)
    }

    sessionId = session.activeSessionId
    if (state === 'disabled' || state === 'degraded') {
      state = 'detached'
      message = `libghostty terminal is ready for session ${sessionId}.`
    }

    return session
  }

  const hydrateSessionOutput = async () => {
    if (state !== 'attached' || !sessionId) {
      return
    }

    const result = await options.fetchSessionEvents(sessionCursor)
    sessionCursor = result.cursor || sessionCursor

    for (const event of result.events) {
      const payload = formatEventPayload(event.payload)
      const text = payload.length > 0
        ? `[${event.type}] ${payload}`
        : `[${event.type}]`
      const channel = resolveSessionEventChannel(event.type)

      pushEvent(channel, text)
    }
  }

  return {
    getStatus: () => getSnapshot(),

    attach: async (attachOptions = {}) => {
      const session = resolveSessionBinding()

      if (session.state !== 'ready' || !session.activeSessionId) {
        pushDiagnostic(`Attach blocked: ${session.message}`)
        return {
          terminal: getSnapshot()
        }
      }

      rows = normalizePositiveInt(attachOptions.rows, rows)
      cols = normalizePositiveInt(attachOptions.cols, cols)
      state = 'attached'
      attachedAt = nowIso()
      detachedAt = null
      message = `libghostty terminal attached to session ${session.activeSessionId}.`

      pushEvent('system', `Attached terminal (${rows}x${cols}) to ${session.activeSessionId}.`)

      return {
        terminal: getSnapshot()
      }
    },

    detach: async (reason = 'detach requested') => {
      const previousSessionId = sessionId

      if (state !== 'disabled') {
        state = 'detached'
      }

      detachedAt = nowIso()
      message = previousSessionId
        ? `libghostty terminal detached from session ${previousSessionId}.`
        : 'libghostty terminal detached.'

      pushEvent('system', `Detached terminal${previousSessionId ? ` from ${previousSessionId}` : ''}: ${reason}.`)

      return {
        terminal: getSnapshot()
      }
    },

    resize: async (nextRows: number, nextCols: number) => {
      rows = normalizePositiveInt(nextRows, rows)
      cols = normalizePositiveInt(nextCols, cols)
      pushEvent('system', `Resized terminal to ${rows}x${cols}.`)

      return {
        terminal: getSnapshot()
      }
    },

    sendInput: async (input: string) => {
      const session = resolveSessionBinding()

      if (state !== 'attached' || !session.activeSessionId) {
        throw new Error('Terminal input requires an attached terminal and ready session bridge.')
      }

      const normalizedInput = input.trimEnd()
      if (normalizedInput.length === 0) {
        return {
          terminal: getSnapshot(),
          accepted: true,
          requestId: null
        }
      }

      pushEvent('system', `$ ${normalizedInput}`)

      const result = await options.sendSessionMessage({
        role: 'user',
        content: normalizedInput
      })

      if (!result.accepted) {
        pushDiagnostic(`Terminal input rejected for session ${result.sessionId}.`)
      }

      return {
        terminal: getSnapshot(),
        accepted: result.accepted,
        requestId: result.requestId
      }
    },

    fetchOutput: async (cursor) => {
      resolveSessionBinding()

      try {
        await hydrateSessionOutput()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        state = 'degraded'
        message = 'libghostty terminal failed to read output from session bridge.'
        pushDiagnostic(errorMessage)
        pushEvent('stderr', `Terminal bridge error: ${errorMessage}`)
      }

      const minSeq = parseCursor(cursor)
      const events = buffer
        .filter((entry) => entry.seq > minSeq)
        .map((entry) => entry.event)
      const lastEvent = events[events.length - 1]

      return {
        terminal: getSnapshot(),
        events,
        cursor: lastEvent?.id || cursor || null
      }
    }
  }
}
