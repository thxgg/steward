import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import type { OpenCodeEngineStatus } from '../../../app/types/launcher.js'

const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:4096'
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 500
const DEFAULT_FETCH_TIMEOUT_MS = 1_500
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000
const HEALTH_PROBE_SUFFIXES = ['', 'health', 'api/health', 'openapi.json']

function isLocalhostEndpoint(endpoint: string | null): boolean {
  if (!endpoint) {
    return false
  }

  try {
    const parsed = new URL(endpoint)
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

function toInstanceKey(endpoint: string | null): string | null {
  if (!endpoint) {
    return null
  }

  return `engine:${endpoint}`
}

function resolveConnectionMode(endpoint: string | null, owned: boolean): 'shared' | 'external' | 'unavailable' {
  if (!endpoint) {
    return 'unavailable'
  }

  if (owned || isLocalhostEndpoint(endpoint)) {
    return 'shared'
  }

  return 'external'
}

function resolveBindingMode(endpoint: string | null): 'localhost' | 'network' | 'unavailable' {
  if (!endpoint) {
    return 'unavailable'
  }

  return isLocalhostEndpoint(endpoint) ? 'localhost' : 'network'
}

function normalizeAuthToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function resolveProvidedAuthToken(optionToken: string | null | undefined): string | null {
  const direct = normalizeAuthToken(optionToken)
  if (direct) {
    return direct
  }

  return normalizeAuthToken(process.env.STEWARD_OPENCODE_AUTH_TOKEN)
    || normalizeAuthToken(process.env.OPENCODE_AUTH_TOKEN)
    || normalizeAuthToken(process.env.OPENCODE_API_KEY)
    || null
}

export interface OpenCodeEngineLifecycleOptions {
  cwd: string
  configuredEndpoint?: string | null
  localEndpoint?: string
  command?: string
  args?: string[]
  authToken?: string | null
  allowRemote?: boolean
  startupTimeoutMs?: number
  healthPollIntervalMs?: number
  fetchTimeoutMs?: number
  shutdownGraceMs?: number
}

export interface OpenCodeEngineLifecycleHandle {
  getStatus(): OpenCodeEngineStatus
  getAuthToken(): string | null
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

async function probeEndpoint(
  endpoint: string,
  fetchTimeoutMs: number,
  authToken?: string | null
): Promise<ProbeResult> {
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
          accept: 'application/json, text/plain, */*',
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
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

function createStoppedStatus(
  message: string,
  endpoint: string | null,
  diagnostics: string[] = [],
  authMode: OpenCodeEngineStatus['authMode'] = 'none'
): OpenCodeEngineStatus {
  const owned = false

  return {
    state: 'stopped',
    endpoint,
    reused: false,
    owned,
    pid: null,
    instanceKey: toInstanceKey(endpoint),
    connectionMode: resolveConnectionMode(endpoint, owned),
    bindingMode: resolveBindingMode(endpoint),
    authMode,
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
  const allowRemote = options.allowRemote === true

  const providedAuthToken = resolveProvidedAuthToken(options.authToken)
  let activeAuthToken: string | null = providedAuthToken
  let authMode: OpenCodeEngineStatus['authMode'] = providedAuthToken ? 'provided' : 'none'

  const selectedEndpoint = configuredEndpoint || localEndpoint
  const selectedBindingMode = resolveBindingMode(selectedEndpoint)

  let managedProcess: ChildProcess | null = null
  let status: OpenCodeEngineStatus = {
    state: 'starting',
    endpoint: selectedEndpoint,
    reused: false,
    owned: false,
    pid: null,
    instanceKey: toInstanceKey(selectedEndpoint),
    connectionMode: resolveConnectionMode(selectedEndpoint, false),
    bindingMode: selectedBindingMode,
    authMode,
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
          const probe = await probeEndpoint(endpoint, fetchTimeoutMs, activeAuthToken)
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

      status = createStoppedStatus(
        `OpenCode lifecycle manager stopped (${reason}).`,
        status.endpoint,
        status.diagnostics,
        status.authMode
      )
      return cloneStatus(status)
    })()

    return await stopPromise
  }

  process.on('exit', forceKillOnExit)

  const lifecycleHandle = (): OpenCodeEngineLifecycleHandle => {
    return {
      getStatus: () => cloneStatus(status),
      getAuthToken: () => activeAuthToken,
      stop
    }
  }

  const configuredBindingMode = resolveBindingMode(configuredEndpoint)
  if (configuredEndpoint) {
    if (configuredBindingMode === 'network' && !allowRemote) {
      appendDiagnostic(
        `Configured endpoint ${configuredEndpoint} is network-visible. Set STEWARD_OPENCODE_ALLOW_REMOTE=1 to opt in.`
      )
    } else if (configuredBindingMode === 'network' && !activeAuthToken) {
      appendDiagnostic(
        `Configured endpoint ${configuredEndpoint} requires an auth token (set STEWARD_OPENCODE_AUTH_TOKEN).`
      )
    } else {
      const configuredProbe = await probeEndpoint(configuredEndpoint, fetchTimeoutMs, activeAuthToken)
      if (configuredProbe.healthy) {
        updateStatus({
          state: 'healthy',
          endpoint: configuredEndpoint,
          reused: true,
          owned: false,
          pid: null,
          instanceKey: toInstanceKey(configuredEndpoint),
          connectionMode: resolveConnectionMode(configuredEndpoint, false),
          bindingMode: configuredBindingMode,
          authMode,
          message: `Reusing healthy OpenCode endpoint at ${configuredEndpoint}.`,
          diagnostics: []
        })
        startBackgroundHealthPoll(configuredEndpoint)

        return lifecycleHandle()
      }

      appendDiagnostic(`Configured endpoint ${configuredEndpoint} is unavailable: ${configuredProbe.detail}`)
    }
  } else if (options.configuredEndpoint) {
    appendDiagnostic(`Configured endpoint is invalid: ${options.configuredEndpoint}`)
  }

  const localBindingMode = resolveBindingMode(localEndpoint)
  if (localBindingMode === 'network' && !allowRemote) {
    appendDiagnostic(
      `Managed local endpoint ${localEndpoint} is network-visible. Set STEWARD_OPENCODE_ALLOW_REMOTE=1 to opt in.`
    )
  } else if (localBindingMode === 'network' && !activeAuthToken) {
    appendDiagnostic(
      `Local endpoint ${localEndpoint} is network-visible and requires auth before reuse. A managed process token will be generated if spawn is needed.`
    )
  } else {
    const localProbe = await probeEndpoint(localEndpoint, fetchTimeoutMs, activeAuthToken)
    if (localProbe.healthy) {
      updateStatus({
        state: 'healthy',
        endpoint: localEndpoint,
        reused: true,
        owned: false,
        pid: null,
        instanceKey: toInstanceKey(localEndpoint),
        connectionMode: resolveConnectionMode(localEndpoint, false),
        bindingMode: localBindingMode,
        authMode,
        message: `Reusing healthy local OpenCode endpoint at ${localEndpoint} to keep a single shared engine instance.`,
        diagnostics: []
      })
      startBackgroundHealthPoll(localEndpoint)

      return lifecycleHandle()
    }

    appendDiagnostic(`No reusable local endpoint at ${localEndpoint}: ${localProbe.detail}`)
  }

  if (localBindingMode === 'network' && !allowRemote) {
    updateStatus({
      state: 'degraded',
      endpoint: localEndpoint,
      reused: false,
      owned: false,
      pid: null,
      instanceKey: toInstanceKey(localEndpoint),
      connectionMode: resolveConnectionMode(localEndpoint, false),
      bindingMode: localBindingMode,
      authMode,
      message: 'Managed engine start blocked: network-visible binding requires explicit opt-in (STEWARD_OPENCODE_ALLOW_REMOTE=1).'
    })

    return lifecycleHandle()
  }

  const commandCheck = commandExists(command)
  if (!commandCheck.available) {
    const targetEndpoint = configuredEndpoint || localEndpoint
    updateStatus({
      state: 'degraded',
      endpoint: targetEndpoint,
      reused: false,
      owned: false,
      pid: null,
      instanceKey: toInstanceKey(targetEndpoint),
      connectionMode: resolveConnectionMode(targetEndpoint, false),
      bindingMode: resolveBindingMode(targetEndpoint),
      authMode,
      message: 'OpenCode CLI is unavailable and no healthy configured endpoint could be reused.'
    })
    appendDiagnostic(commandCheck.detail)

    return lifecycleHandle()
  }

  if (!activeAuthToken) {
    activeAuthToken = randomUUID()
    authMode = 'generated'
  }

  managedProcess = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      STEWARD_OPENCODE_AUTH_TOKEN: activeAuthToken,
      OPENCODE_AUTH_TOKEN: activeAuthToken
    },
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
    instanceKey: toInstanceKey(localEndpoint),
    connectionMode: resolveConnectionMode(localEndpoint, true),
    bindingMode: localBindingMode,
    authMode,
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

    const probe = await probeEndpoint(localEndpoint, fetchTimeoutMs, activeAuthToken)
    lastProbeDetail = probe.detail

    if (probe.healthy) {
      updateStatus({
        state: 'healthy',
        endpoint: localEndpoint,
        reused: false,
        owned: true,
        pid: managedProcess.pid || null,
        instanceKey: toInstanceKey(localEndpoint),
        connectionMode: resolveConnectionMode(localEndpoint, true),
        bindingMode: localBindingMode,
        authMode,
        message: `Managed OpenCode engine is healthy at ${localEndpoint}.`,
        diagnostics: []
      })
      startBackgroundHealthPoll(localEndpoint)

      return lifecycleHandle()
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
    instanceKey: toInstanceKey(localEndpoint),
    connectionMode: resolveConnectionMode(localEndpoint, false),
    bindingMode: localBindingMode,
    authMode,
    message: `Managed OpenCode engine failed to reach healthy state within ${startupTimeoutMs}ms.`
  })

  return lifecycleHandle()
}

export function createDisabledEngineStatus(message: string): OpenCodeEngineStatus {
  return createStoppedStatus(message, null, [])
}
