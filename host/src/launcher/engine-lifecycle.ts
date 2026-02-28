import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import type { OpenCodeEngineStatus } from '../../../app/types/launcher.js'

const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:4096'
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 500
const DEFAULT_FETCH_TIMEOUT_MS = 1_500
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000
const HEALTH_PROBE_SUFFIXES = ['', 'health', 'api/health', 'openapi.json']

export interface OpenCodeEngineLifecycleOptions {
  cwd: string
  configuredEndpoint?: string | null
  localEndpoint?: string
  command?: string
  args?: string[]
  startupTimeoutMs?: number
  healthPollIntervalMs?: number
  fetchTimeoutMs?: number
  shutdownGraceMs?: number
}

export interface OpenCodeEngineLifecycleHandle {
  getStatus(): OpenCodeEngineStatus
  stop(reason?: string): Promise<OpenCodeEngineStatus>
}

type ProbeResult = {
  healthy: boolean
  detail: string
}

function normalizeEndpoint(rawEndpoint: string | null | undefined): string | null {
  const trimmed = rawEndpoint?.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    parsed.hash = ''
    const endpoint = parsed.toString()
    return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
  } catch {
    return null
  }
}

function cloneStatus(status: OpenCodeEngineStatus): OpenCodeEngineStatus {
  return {
    ...status,
    diagnostics: [...status.diagnostics]
  }
}

function buildProbeUrls(endpoint: string): string[] {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`

  return HEALTH_PROBE_SUFFIXES.map((suffix) => {
    return new URL(suffix, base).toString()
  })
}

async function probeEndpoint(endpoint: string, fetchTimeoutMs: number): Promise<ProbeResult> {
  const urls = buildProbeUrls(endpoint)
  let lastFailure = `No successful response from ${endpoint}`

  for (const url of urls) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, fetchTimeoutMs)

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'application/json, text/plain, */*'
        }
      })

      if (response.status < 500) {
        return {
          healthy: true,
          detail: `${url} responded with ${response.status}`
        }
      }

      lastFailure = `${url} responded with ${response.status}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastFailure = `${url} request failed: ${message}`
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    healthy: false,
    detail: lastFailure
  }
}

function commandExists(command: string): { available: boolean; detail: string } {
  try {
    const result = spawnSync(command, ['--version'], {
      stdio: 'ignore'
    })

    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : String(result.error)
      return {
        available: false,
        detail: `Command ${command} is not executable: ${message}`
      }
    }

    return {
      available: true,
      detail: `Command ${command} is available`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      available: false,
      detail: `Failed to detect ${command}: ${message}`
    }
  }
}

function isProcessRunning(processHandle: ChildProcess | null): processHandle is ChildProcess {
  return !!processHandle && processHandle.exitCode === null && processHandle.signalCode === null
}

async function terminateProcess(processHandle: ChildProcess, shutdownGraceMs: number): Promise<void> {
  if (!isProcessRunning(processHandle)) {
    return
  }

  processHandle.kill('SIGTERM')
  await Promise.race([
    once(processHandle, 'exit'),
    delay(shutdownGraceMs)
  ])

  if (!isProcessRunning(processHandle)) {
    return
  }

  processHandle.kill('SIGKILL')
  await Promise.race([
    once(processHandle, 'exit'),
    delay(500)
  ])
}

function toSafePositiveInt(value: number | undefined, fallbackValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallbackValue
  }

  return Math.floor(value)
}

function createStoppedStatus(message: string, endpoint: string | null, diagnostics: string[] = []): OpenCodeEngineStatus {
  return {
    state: 'stopped',
    endpoint,
    reused: false,
    owned: false,
    pid: null,
    checkedAt: new Date().toISOString(),
    message,
    diagnostics
  }
}

export async function startOpenCodeEngineLifecycle(
  options: OpenCodeEngineLifecycleOptions
): Promise<OpenCodeEngineLifecycleHandle> {
  const startupTimeoutMs = toSafePositiveInt(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS)
  const healthPollIntervalMs = toSafePositiveInt(options.healthPollIntervalMs, DEFAULT_HEALTH_POLL_INTERVAL_MS)
  const fetchTimeoutMs = toSafePositiveInt(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS)
  const shutdownGraceMs = toSafePositiveInt(options.shutdownGraceMs, DEFAULT_SHUTDOWN_GRACE_MS)

  const configuredEndpoint = normalizeEndpoint(options.configuredEndpoint)
  const localEndpoint = normalizeEndpoint(options.localEndpoint) || DEFAULT_LOCAL_ENDPOINT
  const command = options.command?.trim() || 'opencode'
  const args = Array.isArray(options.args) && options.args.length > 0
    ? options.args
    : ['serve']

  let managedProcess: ChildProcess | null = null
  let status: OpenCodeEngineStatus = {
    state: 'starting',
    endpoint: configuredEndpoint || localEndpoint,
    reused: false,
    owned: false,
    pid: null,
    checkedAt: new Date().toISOString(),
    message: 'Starting OpenCode engine lifecycle manager.',
    diagnostics: []
  }

  let stopped = false
  let pollTimer: NodeJS.Timeout | null = null
  let pollInFlight = false
  let stopPromise: Promise<OpenCodeEngineStatus> | null = null

  const appendDiagnostic = (message: string) => {
    const entry = message.trim()
    if (!entry) {
      return
    }

    status = {
      ...status,
      checkedAt: new Date().toISOString(),
      diagnostics: [...status.diagnostics, entry].slice(-12)
    }
  }

  const updateStatus = (next: Partial<OpenCodeEngineStatus>) => {
    status = {
      ...status,
      ...next,
      checkedAt: new Date().toISOString()
    }
  }

  const startBackgroundHealthPoll = (endpoint: string) => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }

    pollTimer = setInterval(() => {
      void (async () => {
        if (stopped || pollInFlight) {
          return
        }

        pollInFlight = true
        try {
          const probe = await probeEndpoint(endpoint, fetchTimeoutMs)
          if (probe.healthy) {
            if (status.state !== 'healthy') {
              updateStatus({
                state: 'healthy',
                message: status.reused
                  ? `Reusing healthy OpenCode endpoint at ${endpoint}.`
                  : `Managed OpenCode engine is healthy at ${endpoint}.`
              })
            } else {
              updateStatus({})
            }
            return
          }

          updateStatus({
            state: 'degraded',
            message: `OpenCode engine health check failed for ${endpoint}.`
          })
          appendDiagnostic(`Health polling degraded: ${probe.detail}`)
        } finally {
          pollInFlight = false
        }
      })()
    }, healthPollIntervalMs)
  }

  const forceKillOnExit = () => {
    if (isProcessRunning(managedProcess)) {
      managedProcess.kill('SIGKILL')
    }
  }

  const stop = async (reason = 'launcher shutdown'): Promise<OpenCodeEngineStatus> => {
    if (stopPromise) {
      return await stopPromise
    }

    stopPromise = (async () => {
      stopped = true

      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }

      process.off('exit', forceKillOnExit)

      if (isProcessRunning(managedProcess)) {
        await terminateProcess(managedProcess, shutdownGraceMs)
      }

      managedProcess = null

      status = createStoppedStatus(`OpenCode lifecycle manager stopped (${reason}).`, status.endpoint, status.diagnostics)
      return cloneStatus(status)
    })()

    return await stopPromise
  }

  process.on('exit', forceKillOnExit)

  if (configuredEndpoint) {
    const configuredProbe = await probeEndpoint(configuredEndpoint, fetchTimeoutMs)
    if (configuredProbe.healthy) {
      updateStatus({
        state: 'healthy',
        endpoint: configuredEndpoint,
        reused: true,
        owned: false,
        pid: null,
        message: `Reusing healthy OpenCode endpoint at ${configuredEndpoint}.`,
        diagnostics: []
      })
      startBackgroundHealthPoll(configuredEndpoint)

      return {
        getStatus: () => cloneStatus(status),
        stop
      }
    }

    appendDiagnostic(`Configured endpoint ${configuredEndpoint} is unavailable: ${configuredProbe.detail}`)
  } else if (options.configuredEndpoint) {
    appendDiagnostic(`Configured endpoint is invalid: ${options.configuredEndpoint}`)
  }

  const commandCheck = commandExists(command)
  if (!commandCheck.available) {
    updateStatus({
      state: 'degraded',
      endpoint: configuredEndpoint || localEndpoint,
      reused: false,
      owned: false,
      pid: null,
      message: 'OpenCode CLI is unavailable and no healthy configured endpoint could be reused.'
    })
    appendDiagnostic(commandCheck.detail)

    return {
      getStatus: () => cloneStatus(status),
      stop
    }
  }

  managedProcess = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: 'ignore'
  })

  let spawnFailure: string | null = null
  managedProcess.on('error', (error) => {
    spawnFailure = error instanceof Error ? error.message : String(error)
    appendDiagnostic(`Failed to spawn managed OpenCode process: ${spawnFailure}`)
  })

  updateStatus({
    state: 'starting',
    endpoint: localEndpoint,
    reused: false,
    owned: true,
    pid: managedProcess.pid || null,
    message: `Starting managed OpenCode engine via ${command} ${args.join(' ')}.`
  })

  const startupDeadline = Date.now() + startupTimeoutMs
  let lastProbeDetail = 'no probe completed'

  while (Date.now() < startupDeadline) {
    if (spawnFailure) {
      break
    }

    const currentExitCode = managedProcess ? managedProcess.exitCode : null
    const currentSignalCode = managedProcess ? managedProcess.signalCode : null

    if (!isProcessRunning(managedProcess)) {
      appendDiagnostic(`Managed OpenCode process exited before healthy state (code=${String(currentExitCode)}, signal=${String(currentSignalCode)}).`)
      break
    }

    const probe = await probeEndpoint(localEndpoint, fetchTimeoutMs)
    lastProbeDetail = probe.detail

    if (probe.healthy) {
      updateStatus({
        state: 'healthy',
        endpoint: localEndpoint,
        reused: false,
        owned: true,
        pid: managedProcess.pid || null,
        message: `Managed OpenCode engine is healthy at ${localEndpoint}.`,
        diagnostics: []
      })
      startBackgroundHealthPoll(localEndpoint)

      return {
        getStatus: () => cloneStatus(status),
        stop
      }
    }

    await delay(healthPollIntervalMs)
  }

  appendDiagnostic(`Managed OpenCode engine did not become healthy within ${startupTimeoutMs}ms: ${lastProbeDetail}`)

  if (isProcessRunning(managedProcess)) {
    await terminateProcess(managedProcess, shutdownGraceMs)
  }

  managedProcess = null

  updateStatus({
    state: 'degraded',
    endpoint: localEndpoint,
    reused: false,
    owned: false,
    pid: null,
    message: `Managed OpenCode engine failed to reach healthy state within ${startupTimeoutMs}ms.`
  })

  return {
    getStatus: () => cloneStatus(status),
    stop
  }
}

export function createDisabledEngineStatus(message: string): OpenCodeEngineStatus {
  return createStoppedStatus(message, null, [])
}
