import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { LauncherControlAction, RuntimeHostState } from '../../../app/types/launcher.js'

type ControlErrorKind = 'process' | 'auth' | 'network'

interface LauncherControlServerOptions {
  getState: () => RuntimeHostState
  runAction: (action: LauncherControlAction) => Promise<RuntimeHostState>
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
