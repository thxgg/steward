import type {
  LauncherHostState,
  OpenCodeEngineStatus,
  RuntimeHostState
} from '../../../app/types/launcher.js'
import { detectLauncherCapabilities } from './capabilities.js'
import { HOST_BOUNDARY_CONTRACT } from './contract.js'
import { resolveLauncherContext, type ResolveLauncherContextOptions } from './context.js'
import {
  createDisabledEngineStatus,
  startOpenCodeEngineLifecycle,
  type OpenCodeEngineLifecycleHandle,
  type OpenCodeEngineLifecycleOptions
} from './engine-lifecycle.js'

const DEFAULT_ENGINE_ARGS = ['serve']

export interface LauncherBootstrapOptions extends ResolveLauncherContextOptions {
  manageEngine?: boolean
  engine?: Omit<OpenCodeEngineLifecycleOptions, 'cwd'>
}

export interface LauncherBootstrapResult {
  runtime: RuntimeHostState
  logLines: string[]
  shutdown: () => Promise<void>
}

function parsePositiveInt(rawValue: string | undefined): number | undefined {
  if (!rawValue) {
    return undefined
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

function parseEngineArgs(rawValue: string | undefined): string[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return [...DEFAULT_ENGINE_ARGS]
  }

  const parsed = rawValue
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return parsed.length > 0 ? parsed : [...DEFAULT_ENGINE_ARGS]
}

function resolveEngineOptions(
  repoPath: string,
  overrides?: Omit<OpenCodeEngineLifecycleOptions, 'cwd'>
): OpenCodeEngineLifecycleOptions {
  const configuredEndpoint = process.env.STEWARD_OPENCODE_URL || process.env.OPENCODE_URL || undefined
  const localEndpoint = process.env.STEWARD_OPENCODE_LOCAL_URL || process.env.STEWARD_OPENCODE_ENDPOINT || undefined
  const command = process.env.STEWARD_OPENCODE_COMMAND || undefined
  const args = parseEngineArgs(process.env.STEWARD_OPENCODE_ARGS)

  const startupTimeoutMs = parsePositiveInt(process.env.STEWARD_OPENCODE_STARTUP_TIMEOUT_MS)
  const healthPollIntervalMs = parsePositiveInt(process.env.STEWARD_OPENCODE_HEALTH_POLL_INTERVAL_MS)
  const fetchTimeoutMs = parsePositiveInt(process.env.STEWARD_OPENCODE_FETCH_TIMEOUT_MS)
  const shutdownGraceMs = parsePositiveInt(process.env.STEWARD_OPENCODE_SHUTDOWN_GRACE_MS)

  return {
    cwd: repoPath,
    configuredEndpoint,
    localEndpoint,
    command,
    args,
    startupTimeoutMs,
    healthPollIntervalMs,
    fetchTimeoutMs,
    shutdownGraceMs,
    ...overrides
  }
}

function buildWarnings(payload: LauncherHostState): string[] {
  const warnings = [...payload.warnings]

  if (!payload.context?.prdSlug) {
    warnings.push('No PRD was auto-resolved for this workspace. The UI will start at repository scope.')
  }

  if (payload.engine.state === 'degraded') {
    warnings.push(payload.engine.message)
  }

  return [...new Set(warnings)]
}

export async function bootstrapLauncher(
  options: LauncherBootstrapOptions = {}
): Promise<LauncherBootstrapResult> {
  const context = await resolveLauncherContext(options)
  const shouldManageEngine = options.manageEngine !== false

  let engineHandle: OpenCodeEngineLifecycleHandle | null = null
  let engineStatus: OpenCodeEngineStatus = createDisabledEngineStatus(
    'OpenCode lifecycle manager was not started for this launcher bootstrap.'
  )

  if (shouldManageEngine) {
    engineHandle = await startOpenCodeEngineLifecycle(resolveEngineOptions(context.repoPath, options.engine))
    engineStatus = engineHandle.getStatus()
  }

  const capabilities = detectLauncherCapabilities(engineStatus)

  const launcherPayload: LauncherHostState = {
    context,
    engine: engineStatus,
    capabilities,
    warnings: [],
    contract: HOST_BOUNDARY_CONTRACT
  }

  launcherPayload.warnings = buildWarnings(launcherPayload)

  const unavailableCount = capabilities.filter((capability) => !capability.available).length

  const logLines = [
    `Launcher context resolved: repo=${context.repoName} (${context.repoId})`,
    `Launcher PRD context: ${context.prdSlug || '<none>'} (${context.prdSource})`,
    `OpenCode engine state: ${engineStatus.state}${engineStatus.endpoint ? ` (${engineStatus.endpoint})` : ''}`,
    `Launcher capabilities: ${capabilities.length - unavailableCount}/${capabilities.length} available`
  ]

  return {
    runtime: {
      mode: 'launcher',
      launcher: launcherPayload
    },
    logLines,
    shutdown: async () => {
      if (!engineHandle) {
        return
      }

      await engineHandle.stop('launcher ui exit')
    }
  }
}
