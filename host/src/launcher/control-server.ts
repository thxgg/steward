import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type {
  LauncherControlAction,
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
} from '../../../app/types/launcher.js'

type ControlErrorKind = 'process' | 'auth' | 'network'

interface LauncherControlServerOptions {
  getState: () => RuntimeHostState
  runAction: (action: LauncherControlAction) => Promise<RuntimeHostState>
  getSessionState?: () => SessionBridgeStatus
  sendSessionMessage?: (input: SessionBridgeMessageInput) => Promise<SessionBridgeMessageResult>
  fetchSessionEvents?: (cursor?: string | null) => Promise<SessionBridgeEventsResult>
  getTerminalState?: () => TerminalBridgeStatus
  attachTerminal?: (options?: { rows?: number; cols?: number }) => Promise<TerminalAttachResult>
  detachTerminal?: (reason?: string) => Promise<TerminalDetachResult>
  sendTerminalInput?: (input: string) => Promise<TerminalInputResult>
  resizeTerminal?: (rows: number, cols: number) => Promise<TerminalResizeResult>
  fetchTerminalOutput?: (cursor?: string | null) => Promise<TerminalOutputResult>
}

interface LauncherControlServerResponse<T> {
  ok: boolean
  result?: T
  error?: {
    kind: ControlErrorKind
    code: string
    message: string
  }
}

type SessionActionBody = {
  role?: unknown
  content?: unknown
}

type TerminalAttachBody = {
  rows?: unknown
  cols?: unknown
}

type TerminalDetachBody = {
  reason?: unknown
}

type TerminalInputBody = {
  input?: unknown
}

type TerminalResizeBody = {
  rows?: unknown
  cols?: unknown
}

export interface LauncherControlServerHandle {
  url: string
  token: string
  close(): Promise<void>
}

function writeJson<T>(
  response: import('node:http').ServerResponse,
  statusCode: number,
  payload: LauncherControlServerResponse<T>
) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

function isLauncherControlAction(value: unknown): value is LauncherControlAction {
  return value === 'retry' || value === 'reconnect' || value === 'restart'
}

function parseSessionMessageInput(value: unknown): SessionBridgeMessageInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as SessionActionBody
  if (body.role !== 'user' && body.role !== 'assistant' && body.role !== 'system') {
    return null
  }

  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return null
  }

  return {
    role: body.role,
    content: body.content
  }
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function parseTerminalAttachOptions(value: unknown): { rows?: number; cols?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const body = value as TerminalAttachBody
  const rows = parsePositiveInt(body.rows)
  const cols = parsePositiveInt(body.cols)

  return {
    ...(rows ? { rows } : {}),
    ...(cols ? { cols } : {})
  }
}

function parseTerminalDetachReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const body = value as TerminalDetachBody
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return undefined
  }

  return body.reason.trim()
}

function parseTerminalInput(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as TerminalInputBody
  if (typeof body.input !== 'string' || body.input.length === 0) {
    return null
  }

  return body.input
}

function parseTerminalResize(value: unknown): { rows: number; cols: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as TerminalResizeBody
  const rows = parsePositiveInt(body.rows)
  const cols = parsePositiveInt(body.cols)

  if (!rows || !cols) {
    return null
  }

  return { rows, cols }
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  const body = Buffer.concat(chunks).toString('utf-8').trim()
  if (!body) {
    return {}
  }

  return JSON.parse(body) as unknown
}

function isAuthorized(request: import('node:http').IncomingMessage, token: string): boolean {
  const header = request.headers['x-steward-launcher-token']
  if (typeof header !== 'string') {
    return false
  }

  return header === token
}

export async function startLauncherControlServer(
  options: LauncherControlServerOptions
): Promise<LauncherControlServerHandle> {
  const token = randomUUID()

  const server = createServer(async (request, response) => {
    if (!isAuthorized(request, token)) {
      writeJson(response, 401, {
        ok: false,
        error: {
          kind: 'auth',
          code: 'LAUNCHER_CONTROL_AUTH',
          message: 'Unauthorized launcher control request.'
        }
      })
      return
    }

    const method = request.method || 'GET'
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')

    if (method === 'GET' && requestUrl.pathname === '/state') {
      writeJson(response, 200, {
        ok: true,
        result: options.getState()
      })
      return
    }

    if (method === 'POST' && requestUrl.pathname === '/action') {
      try {
        const body = await readJsonBody(request)
        const action = typeof body === 'object' && body !== null
          ? (body as { action?: unknown }).action
          : undefined

        if (!isLauncherControlAction(action)) {
          writeJson(response, 400, {
            ok: false,
            error: {
              kind: 'process',
              code: 'LAUNCHER_CONTROL_INVALID_ACTION',
              message: 'Invalid launcher action.'
            }
          })
          return
        }

        const state = await options.runAction(action)
        writeJson(response, 200, {
          ok: true,
          result: state
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_CONTROL_ACTION_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'GET' && requestUrl.pathname === '/session') {
      if (!options.getSessionState) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_SESSION_BRIDGE_DISABLED',
            message: 'Session bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      writeJson(response, 200, {
        ok: true,
        result: options.getSessionState()
      })
      return
    }

    if (method === 'POST' && requestUrl.pathname === '/session/message') {
      if (!options.sendSessionMessage) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_SESSION_BRIDGE_DISABLED',
            message: 'Session bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const body = await readJsonBody(request)
        const input = parseSessionMessageInput(body)

        if (!input) {
          writeJson(response, 400, {
            ok: false,
            error: {
              kind: 'process',
              code: 'LAUNCHER_SESSION_INVALID_INPUT',
              message: 'Session message requires role and content.'
            }
          })
          return
        }

        const result = await options.sendSessionMessage(input)
        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_SESSION_MESSAGE_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'GET' && requestUrl.pathname === '/session/events') {
      if (!options.fetchSessionEvents) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_SESSION_BRIDGE_DISABLED',
            message: 'Session bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const cursor = requestUrl.searchParams.get('cursor')
        const result = await options.fetchSessionEvents(cursor)
        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_SESSION_EVENTS_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'GET' && requestUrl.pathname === '/terminal/state') {
      if (!options.getTerminalState) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      writeJson(response, 200, {
        ok: true,
        result: options.getTerminalState()
      })
      return
    }

    if (method === 'POST' && requestUrl.pathname === '/terminal/attach') {
      if (!options.attachTerminal) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const body = await readJsonBody(request)
        const attachOptions = parseTerminalAttachOptions(body)
        const result = await options.attachTerminal(attachOptions || undefined)

        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_ATTACH_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'POST' && requestUrl.pathname === '/terminal/detach') {
      if (!options.detachTerminal) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const body = await readJsonBody(request)
        const reason = parseTerminalDetachReason(body)
        const result = await options.detachTerminal(reason)

        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DETACH_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'POST' && requestUrl.pathname === '/terminal/input') {
      if (!options.sendTerminalInput) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const body = await readJsonBody(request)
        const input = parseTerminalInput(body)

        if (input === null) {
          writeJson(response, 400, {
            ok: false,
            error: {
              kind: 'process',
              code: 'LAUNCHER_TERMINAL_INVALID_INPUT',
              message: 'Terminal input requires a non-empty input string.'
            }
          })
          return
        }

        const result = await options.sendTerminalInput(input)
        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_INPUT_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'POST' && requestUrl.pathname === '/terminal/resize') {
      if (!options.resizeTerminal) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const body = await readJsonBody(request)
        const resize = parseTerminalResize(body)

        if (!resize) {
          writeJson(response, 400, {
            ok: false,
            error: {
              kind: 'process',
              code: 'LAUNCHER_TERMINAL_INVALID_SIZE',
              message: 'Terminal resize requires positive rows and cols values.'
            }
          })
          return
        }

        const result = await options.resizeTerminal(resize.rows, resize.cols)
        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_RESIZE_FAILED',
            message
          }
        })
      }

      return
    }

    if (method === 'GET' && requestUrl.pathname === '/terminal/output') {
      if (!options.fetchTerminalOutput) {
        writeJson(response, 503, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_DISABLED',
            message: 'libghostty terminal bridge is not configured for this launcher runtime.'
          }
        })
        return
      }

      try {
        const cursor = requestUrl.searchParams.get('cursor')
        const result = await options.fetchTerminalOutput(cursor)
        writeJson(response, 200, {
          ok: true,
          result
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, {
          ok: false,
          error: {
            kind: 'process',
            code: 'LAUNCHER_TERMINAL_OUTPUT_FAILED',
            message
          }
        })
      }

      return
    }

    writeJson(response, 404, {
      ok: false,
      error: {
        kind: 'process',
        code: 'LAUNCHER_CONTROL_NOT_FOUND',
        message: 'Launcher control route was not found.'
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to resolve launcher control server address')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}
