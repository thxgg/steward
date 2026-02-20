import vm from 'node:vm'
import { git, prds, repos, state } from './api'

const MAX_OUTPUT_SIZE = 50_000
const EXECUTION_TIMEOUT_MS = 30_000
const MAX_TIMERS = 100

export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly stackTrace?: string
  ) {
    super(message)
    this.name = 'ExecutionError'
  }
}

function truncateOutput(result: unknown): unknown {
  if (result === undefined) {
    return undefined
  }

  let json: string
  try {
    json = JSON.stringify(result, null, 2)
  } catch {
    return {
      _unserializable: true,
      preview: String(result)
    }
  }

  if (json.length <= MAX_OUTPUT_SIZE) {
    return result
  }

  return {
    _truncated: true,
    size: json.length,
    preview: json.slice(0, MAX_OUTPUT_SIZE),
    message: `Output truncated (${json.length} chars, showing first ${MAX_OUTPUT_SIZE})`
  }
}

export async function execute(code: string): Promise<unknown> {
  if (!code || !code.trim()) {
    throw new ExecutionError('Code cannot be empty')
  }

  const timers = new Set<NodeJS.Timeout>()

  const sandbox = {
    repos,
    prds,
    git,
    state,
    console: {
      log: (...args: unknown[]) => console.log('[codemode]', ...args),
      error: (...args: unknown[]) => console.error('[codemode]', ...args)
    },
    setTimeout: (handler: () => void, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new Error(`Timer limit exceeded (max ${MAX_TIMERS})`)
      }

      const timer = setTimeout(() => {
        timers.delete(timer)
        handler()
      }, timeout)

      timers.add(timer)
      return timer
    },
    clearTimeout: (timer: NodeJS.Timeout) => {
      timers.delete(timer)
      clearTimeout(timer)
    },
    setInterval: (handler: () => void, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new Error(`Timer limit exceeded (max ${MAX_TIMERS})`)
      }

      const timer = setInterval(handler, timeout)
      timers.add(timer)
      return timer
    },
    clearInterval: (timer: NodeJS.Timeout) => {
      timers.delete(timer)
      clearInterval(timer)
    },
    Promise
  }

  const wrappedCode = `
    (async () => {
      ${code}
    })()
  `

  try {
    const script = new vm.Script(wrappedCode, {
      filename: 'codemode.js'
    })

    const context = vm.createContext(sandbox)
    const result = await script.runInContext(context, {
      timeout: EXECUTION_TIMEOUT_MS
    })

    return truncateOutput(result)
  } catch (error) {
    if (error instanceof Error) {
      throw new ExecutionError(error.message, error.stack)
    }

    throw new ExecutionError(String(error))
  } finally {
    timers.forEach((timer) => {
      clearTimeout(timer)
      clearInterval(timer)
    })
    timers.clear()
  }
}
