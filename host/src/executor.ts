import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EXECUTION_TIMEOUT_MS = 30_000
const MAX_STDIO_CAPTURE = 200_000

function getForwardedNodeFlags(): string[] {
  const forwarded: string[] = []

  for (const arg of process.execArgv) {
    if (arg === '--experimental-sqlite' || arg === '--no-experimental-sqlite') {
      forwarded.push(arg)
      continue
    }

    if (arg.startsWith('--experimental-sqlite=')) {
      forwarded.push(arg)
    }
  }

  return forwarded
}

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

function normalizeFailure(error: unknown): ExecutionFailure {
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

function buildFailureEnvelope(
  startedAt: number,
  code: string,
  message: string,
  details?: unknown
): ExecutionEnvelope {
  return {
    ok: false,
    result: null,
    logs: [],
    error: {
      code,
      message,
      ...(details !== undefined && { details })
    },
    meta: {
      timeoutMs: EXECUTION_TIMEOUT_MS,
      durationMs: Date.now() - startedAt,
      truncatedResult: false,
      truncatedLogs: false,
      resultWasUndefined: false
    }
  }
}

function withDurationFallback(envelope: ExecutionEnvelope, startedAt: number): ExecutionEnvelope {
  const durationMs = Number.isFinite(envelope.meta.durationMs) && envelope.meta.durationMs >= 0
    ? envelope.meta.durationMs
    : Date.now() - startedAt

  return {
    ...envelope,
    meta: {
      ...envelope.meta,
      timeoutMs: EXECUTION_TIMEOUT_MS,
      durationMs
    }
  }
}

function looksLikeExecutionEnvelope(value: unknown): value is ExecutionEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ExecutionEnvelope>
  return typeof candidate.ok === 'boolean'
    && Array.isArray(candidate.logs)
    && candidate.meta !== undefined
}

export async function execute(code: string): Promise<ExecutionEnvelope> {
  const startedAt = Date.now()

  if (!code || !code.trim()) {
    return buildFailureEnvelope(startedAt, 'EMPTY_CODE', 'Code cannot be empty')
  }

  const runnerPath = fileURLToPath(new URL('./executor-runner.js', import.meta.url))
  const childArgs = [
    ...getForwardedNodeFlags(),
    '--max-old-space-size=256',
    runnerPath
  ]

  return await new Promise<ExecutionEnvelope>((resolveEnvelope) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STEWARD_EXECUTION_TIMEOUT_MS: String(EXECUTION_TIMEOUT_MS)
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let settled = false
    let stdout = ''
    let stderr = ''

    const finish = (envelope: ExecutionEnvelope) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(killTimer)
      resolveEnvelope(withDurationFallback(envelope, startedAt))
    }

    const captureOutput = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_STDIO_CAPTURE) {
        return current
      }

      const remaining = MAX_STDIO_CAPTURE - current.length
      return current + chunk.toString('utf-8', 0, remaining)
    }

    const killTimer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(buildFailureEnvelope(startedAt, 'TIMEOUT', `Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`))
    }, EXECUTION_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = captureOutput(stdout, chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = captureOutput(stderr, chunk)
    })

    child.on('error', (error) => {
      const failure = normalizeFailure(error)
      finish(buildFailureEnvelope(startedAt, failure.code, failure.message, failure.details))
    })

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return
      }

      const trimmedStdout = stdout.trim()

      if (!trimmedStdout) {
        const message = signal
          ? `Execution process terminated by signal ${signal}`
          : `Execution process exited with code ${exitCode ?? 0}`

        finish(buildFailureEnvelope(startedAt, 'EXECUTION_PROCESS_FAILURE', message, {
          exitCode,
          signal,
          stderr: stderr.trim() || undefined
        }))
        return
      }

      try {
        const parsed = JSON.parse(trimmedStdout) as unknown
        if (looksLikeExecutionEnvelope(parsed)) {
          finish(parsed)
          return
        }

        finish(buildFailureEnvelope(startedAt, 'INVALID_ENVELOPE', 'Execution process returned an invalid envelope', {
          outputPreview: trimmedStdout.slice(0, 2000),
          stderr: stderr.trim() || undefined,
          exitCode,
          signal
        }))
      } catch (error) {
        const failure = normalizeFailure(error)
        finish(buildFailureEnvelope(startedAt, 'INVALID_JSON', failure.message, {
          outputPreview: trimmedStdout.slice(0, 2000),
          stderr: stderr.trim() || undefined,
          exitCode,
          signal
        }))
      }
    })

    try {
      child.stdin.end(JSON.stringify({ code }))
    } catch (error) {
      const failure = normalizeFailure(error)
      finish(buildFailureEnvelope(startedAt, 'EXECUTION_PIPE_FAILURE', failure.message))
    }
  })
}
