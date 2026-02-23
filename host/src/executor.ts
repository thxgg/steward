import vm from 'node:vm'
import { git, prds, repos, state } from './api/index.js'
import { getStewardHelp } from './help.js'

const MAX_OUTPUT_SIZE = 50_000
const EXECUTION_TIMEOUT_MS = 30_000
const MAX_TIMERS = 100
const MAX_LOG_ENTRIES = 200
const MAX_LOG_OUTPUT_SIZE = 20_000
const MAX_LOG_ENTRY_SIZE = 2_000

export type ExecutionLogLevel = 'log' | 'info' | 'warn' | 'error'

export type ExecutionLogEntry = {
  level: ExecutionLogLevel
  message: string
  timestamp: string
}

export type ExecutionFailure = {
  code: string
  message: string
  stack?: string
  details?: unknown
}

export type ExecutionEnvelope = {
  ok: boolean
  result: unknown | null
  logs: ExecutionLogEntry[]
  error: ExecutionFailure | null
  meta: {
    timeoutMs: number
    durationMs: number
    truncatedResult: boolean
    truncatedLogs: boolean
    resultWasUndefined: boolean
  }
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly options?: {
      code?: string
      stackTrace?: string
      details?: unknown
    }
  ) {
    super(message)
    this.name = 'ExecutionError'
  }
}

function safeJsonStringify(value: unknown): string | undefined {
  const seen = new WeakSet<object>()

  try {
    return JSON.stringify(value, (_key, currentValue: unknown) => {
      if (typeof currentValue === 'bigint') {
        return `${currentValue}n`
      }

      if (typeof currentValue === 'function') {
        const functionName = currentValue.name ? ` ${currentValue.name}` : ''
        return `[Function${functionName}]`
      }

      if (typeof currentValue === 'symbol') {
        return currentValue.toString()
      }

      if (typeof currentValue === 'object' && currentValue !== null) {
        if (seen.has(currentValue)) {
          return '[Circular]'
        }

        seen.add(currentValue)
      }

      return currentValue
    })
  } catch {
    return undefined
  }
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  const json = safeJsonStringify(value)
  if (json !== undefined) {
    return json
  }

  return String(value)
}

function truncateResult(result: unknown): {
  result: unknown | null
  truncatedResult: boolean
  resultWasUndefined: boolean
} {
  if (result === undefined) {
    return {
      result: null,
      truncatedResult: false,
      resultWasUndefined: true
    }
  }

  const json = safeJsonStringify(result)
  if (json === undefined) {
    return {
      result: {
        _unserializable: true,
        preview: String(result)
      },
      truncatedResult: false,
      resultWasUndefined: false
    }
  }

  if (json.length <= MAX_OUTPUT_SIZE) {
    return {
      result,
      truncatedResult: false,
      resultWasUndefined: false
    }
  }

  return {
    result: {
      _truncated: true,
      size: json.length,
      preview: json.slice(0, MAX_OUTPUT_SIZE),
      message: `Output truncated (${json.length} chars, showing first ${MAX_OUTPUT_SIZE})`
    },
    truncatedResult: true,
    resultWasUndefined: false
  }
}

function normalizeFailure(error: unknown): ExecutionFailure {
  if (error instanceof ExecutionError) {
    return {
      code: error.options?.code || 'EXECUTION_ERROR',
      message: error.message,
      ...(error.options?.stackTrace && { stack: error.options.stackTrace }),
      ...(error.options?.details !== undefined && { details: error.options.details })
    }
  }

  if (error instanceof Error) {
    const { code, details } = error as { code?: unknown; details?: unknown }

    return {
      code: typeof code === 'string' ? code : 'EXECUTION_ERROR',
      message: error.message,
      ...(error.stack && { stack: error.stack }),
      ...(details !== undefined && { details })
    }
  }

  return {
    code: 'EXECUTION_ERROR',
    message: String(error)
  }
}

export async function execute(code: string): Promise<ExecutionEnvelope> {
  const startedAt = Date.now()
  const logs: ExecutionLogEntry[] = []
  let totalLogChars = 0
  let logsTruncated = false

  const appendLog = (level: ExecutionLogLevel, args: unknown[]): void => {
    if (logs.length >= MAX_LOG_ENTRIES) {
      logsTruncated = true
      return
    }

    let message = args.map(formatLogValue).join(' ')
    if (message.length > MAX_LOG_ENTRY_SIZE) {
      message = `${message.slice(0, MAX_LOG_ENTRY_SIZE)}...`
      logsTruncated = true
    }

    if (totalLogChars + message.length > MAX_LOG_OUTPUT_SIZE) {
      logsTruncated = true
      return
    }

    totalLogChars += message.length
    logs.push({
      level,
      message,
      timestamp: new Date().toISOString()
    })
  }

  const buildEnvelope = (params: {
    ok: boolean
    result: unknown | null
    error: ExecutionFailure | null
    truncatedResult: boolean
    resultWasUndefined: boolean
  }): ExecutionEnvelope => ({
    ok: params.ok,
    result: params.result,
    logs,
    error: params.error,
    meta: {
      timeoutMs: EXECUTION_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      truncatedResult: params.truncatedResult,
      truncatedLogs: logsTruncated,
      resultWasUndefined: params.resultWasUndefined
    }
  })

  if (!code || !code.trim()) {
    const error = normalizeFailure(new ExecutionError('Code cannot be empty', { code: 'EMPTY_CODE' }))

    return buildEnvelope({
      ok: false,
      result: null,
      error,
      truncatedResult: false,
      resultWasUndefined: false
    })
  }

  const timers = new Set<NodeJS.Timeout>()
  let executionTimeout: NodeJS.Timeout | null = null
  let asyncCallbackError: unknown = null

  const wrapTimerHandler = (handler: () => void) => {
    return () => {
      try {
        handler()
      } catch (error) {
        const normalizedError = error instanceof Error
          ? error
          : new Error(String(error))

        asyncCallbackError = normalizedError
        appendLog('error', ['Timer callback error:', normalizedError.message])
      }
    }
  }

  const ensureTimerHandler = (handler: unknown): (() => void) => {
    if (typeof handler !== 'function') {
      throw new ExecutionError('Timer handler must be a function', {
        code: 'INVALID_TIMER_HANDLER'
      })
    }

    return wrapTimerHandler(handler as () => void)
  }

  const sandbox = {
    repos,
    prds,
    git,
    state,
    steward: {
      help: () => getStewardHelp()
    },
    console: {
      log: (...args: unknown[]) => appendLog('log', args),
      info: (...args: unknown[]) => appendLog('info', args),
      warn: (...args: unknown[]) => appendLog('warn', args),
      error: (...args: unknown[]) => appendLog('error', args)
    },
    setTimeout: (handler: unknown, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new ExecutionError(`Timer limit exceeded (max ${MAX_TIMERS})`, {
          code: 'TIMER_LIMIT'
        })
      }

      const wrappedHandler = ensureTimerHandler(handler)
      const timer = setTimeout(() => {
        timers.delete(timer)
        wrappedHandler()
      }, timeout)

      timers.add(timer)
      return timer
    },
    clearTimeout: (timer: NodeJS.Timeout) => {
      timers.delete(timer)
      clearTimeout(timer)
    },
    setInterval: (handler: unknown, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new ExecutionError(`Timer limit exceeded (max ${MAX_TIMERS})`, {
          code: 'TIMER_LIMIT'
        })
      }

      const wrappedHandler = ensureTimerHandler(handler)
      const timer = setInterval(wrappedHandler, timeout)
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
    const executionPromise = Promise.resolve(script.runInContext(context, {
      timeout: EXECUTION_TIMEOUT_MS
    }))

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      executionTimeout = setTimeout(() => {
        reject(new ExecutionError(`Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`, {
          code: 'TIMEOUT'
        }))
      }, EXECUTION_TIMEOUT_MS)
    })

    const rawResult = await Promise.race([executionPromise, timeoutPromise])

    if (asyncCallbackError instanceof Error) {
      throw new ExecutionError(asyncCallbackError.message, {
        code: 'ASYNC_CALLBACK_ERROR',
        stackTrace: asyncCallbackError.stack
      })
    }

    const truncated = truncateResult(rawResult)

    return buildEnvelope({
      ok: true,
      result: truncated.result,
      error: null,
      truncatedResult: truncated.truncatedResult,
      resultWasUndefined: truncated.resultWasUndefined
    })
  } catch (error) {
    const failure = normalizeFailure(error)
    appendLog('error', [`${failure.code}: ${failure.message}`])

    return buildEnvelope({
      ok: false,
      result: null,
      error: failure,
      truncatedResult: false,
      resultWasUndefined: false
    })
  } finally {
    if (executionTimeout) {
      clearTimeout(executionTimeout)
    }

    timers.forEach((timer) => {
      clearTimeout(timer)
      clearInterval(timer)
    })
    timers.clear()
  }
}
