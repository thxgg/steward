import type {
  LauncherControlAction,
  LauncherUiError,
  LauncherUiErrorKind,
  RuntimeHostState,
  SessionBridgeEventsResult,
  SessionBridgeMessageInput,
  SessionBridgeMessageResult,
  SessionBridgeStatus,
  TerminalAttachResult,
  TerminalBridgeStatus,
  TerminalDetachResult,
  TerminalInputResult,
  TerminalOutputResult,
  TerminalResizeResult
} from '../../app/types/launcher.js'

type ControlResponse<T> = {
  ok: boolean
  result?: T
  error?: {
    kind?: LauncherUiErrorKind
    code?: string
    message?: string
  }
}

const CONTROL_TIMEOUT_MS = 3_000

export class LauncherControlError extends Error {
  constructor(
    message: string,
    public readonly kind: LauncherUiErrorKind,
    public readonly code: string
  ) {
    super(message)
    this.name = 'LauncherControlError'
  }
}

function getControlConfig(): { url: string; token: string } {
  const url = process.env.STEWARD_LAUNCHER_CONTROL_URL?.trim()
  const token = process.env.STEWARD_LAUNCHER_CONTROL_TOKEN?.trim()

  if (!url || !token) {
    throw new LauncherControlError(
      'Launcher control channel is not configured for this runtime.',
      'process',
      'LAUNCHER_CONTROL_DISABLED'
    )
  }

  return { url, token }
}

function normalizeError(error: unknown): LauncherControlError {
  if (error instanceof LauncherControlError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new LauncherControlError(message, 'network', 'LAUNCHER_CONTROL_NETWORK')
}

async function controlRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getControlConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, CONTROL_TIMEOUT_MS)

  let response: Response

  try {
    response = await fetch(`${config.url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'x-steward-launcher-token': config.token,
        'content-type': 'application/json',
        ...(init.headers || {})
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new LauncherControlError(
      `Unable to reach launcher control service: ${message}`,
      'network',
      'LAUNCHER_CONTROL_NETWORK'
    )
  } finally {
    clearTimeout(timeout)
  }

  let payload: ControlResponse<T> | null = null
  try {
    payload = await response.json() as ControlResponse<T>
  } catch {
    payload = null
  }

  if (response.status === 401 || response.status === 403) {
    throw new LauncherControlError(
      payload?.error?.message || 'Launcher control authentication failed.',
      'auth',
      payload?.error?.code || 'LAUNCHER_CONTROL_AUTH'
    )
  }

  if (!response.ok || !payload || payload.ok !== true || payload.result === undefined) {
    const message = payload?.error?.message
      || `Launcher control request failed with status ${response.status}`
    const code = payload?.error?.code || 'LAUNCHER_CONTROL_PROCESS'
    const kind = payload?.error?.kind || 'process'

    throw new LauncherControlError(message, kind, code)
  }

  return payload.result
}

export async function fetchLauncherRuntimeState(): Promise<RuntimeHostState> {
  try {
    return await controlRequest<RuntimeHostState>('/state', {
      method: 'GET'
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherAction(action: LauncherControlAction): Promise<RuntimeHostState> {
  try {
    return await controlRequest<RuntimeHostState>('/action', {
      method: 'POST',
      body: JSON.stringify({ action })
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function fetchLauncherSessionState(): Promise<SessionBridgeStatus> {
  try {
    return await controlRequest<SessionBridgeStatus>('/session', {
      method: 'GET'
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherSessionMessage(
  input: SessionBridgeMessageInput
): Promise<SessionBridgeMessageResult> {
  try {
    return await controlRequest<SessionBridgeMessageResult>('/session/message', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function fetchLauncherSessionEvents(cursor?: string | null): Promise<SessionBridgeEventsResult> {
  const query = cursor && cursor.trim().length > 0
    ? `?cursor=${encodeURIComponent(cursor.trim())}`
    : ''

  try {
    return await controlRequest<SessionBridgeEventsResult>(`/session/events${query}`, {
      method: 'GET'
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function fetchLauncherTerminalState(): Promise<TerminalBridgeStatus> {
  try {
    return await controlRequest<TerminalBridgeStatus>('/terminal/state', {
      method: 'GET'
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherTerminalAttach(options: { rows?: number; cols?: number } = {}): Promise<TerminalAttachResult> {
  try {
    return await controlRequest<TerminalAttachResult>('/terminal/attach', {
      method: 'POST',
      body: JSON.stringify(options)
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherTerminalDetach(reason?: string): Promise<TerminalDetachResult> {
  try {
    return await controlRequest<TerminalDetachResult>('/terminal/detach', {
      method: 'POST',
      body: JSON.stringify({ reason })
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherTerminalInput(input: string): Promise<TerminalInputResult> {
  try {
    return await controlRequest<TerminalInputResult>('/terminal/input', {
      method: 'POST',
      body: JSON.stringify({ input })
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function invokeLauncherTerminalResize(rows: number, cols: number): Promise<TerminalResizeResult> {
  try {
    return await controlRequest<TerminalResizeResult>('/terminal/resize', {
      method: 'POST',
      body: JSON.stringify({ rows, cols })
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export async function fetchLauncherTerminalOutput(cursor?: string | null): Promise<TerminalOutputResult> {
  const query = cursor && cursor.trim().length > 0
    ? `?cursor=${encodeURIComponent(cursor.trim())}`
    : ''

  try {
    return await controlRequest<TerminalOutputResult>(`/terminal/output${query}`, {
      method: 'GET'
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

export function toLauncherUiError(error: unknown): LauncherUiError {
  const normalized = normalizeError(error)
  return {
    kind: normalized.kind,
    code: normalized.code,
    message: normalized.message
  }
}
