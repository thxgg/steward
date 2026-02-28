import type {
  LauncherControlAction,
  LauncherHostState,
  OpenCodeEngineStatus,
  SessionBridgeEventsResult,
  SessionBridgeMessageInput,
  SessionBridgeMessageResult,
  SessionBridgeStatus,
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
import { startLauncherControlServer, type LauncherControlServerHandle } from './control-server.js'
import { startSessionBridge } from './session-bridge.js'

const DEFAULT_ENGINE_ARGS = ['serve']

export interface LauncherBootstrapOptions extends ResolveLauncherContextOptions {
  manageEngine?: boolean
  engine?: Omit<OpenCodeEngineLifecycleOptions, 'cwd'>
  sessionId?: string
}

export interface LauncherBootstrapResult {
  runtime: RuntimeHostState
  logLines: string[]
  control: {
    url: string
    token: string
  }
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

  if (payload.session.state === 'degraded') {
    warnings.push(payload.session.message)
  }

  return [...new Set(warnings)]
}

function buildLauncherPayload(
  context: LauncherHostState['context'],
  engine: OpenCodeEngineStatus,
  session: SessionBridgeStatus
): LauncherHostState {
  const capabilities = detectLauncherCapabilities(engine, session)

  const payload: LauncherHostState = {
    context,
    engine,
    session,
    capabilities,
    warnings: [],
    contract: HOST_BOUNDARY_CONTRACT
  }

  payload.warnings = buildWarnings(payload)
  return payload
}

export async function bootstrapLauncher(
  options: LauncherBootstrapOptions = {}
): Promise<LauncherBootstrapResult> {
  const context = await resolveLauncherContext(options)
  const shouldManageEngine = options.manageEngine !== false

  let engineHandle: OpenCodeEngineLifecycleHandle | null = null
  let currentEngineStatus: OpenCodeEngineStatus = createDisabledEngineStatus(
    'OpenCode lifecycle manager was not started for this launcher bootstrap.'
  )
  let currentSessionStatus: SessionBridgeStatus = {
    state: 'disabled',
    activeSessionId: null,
    source: 'none',
    workspaceKey: `${context.repoId}::unbound`,
    endpoint: null,
    lastResolvedAt: new Date(0).toISOString(),
    message: 'Session bridge is waiting for an active OpenCode engine endpoint.',
    diagnostics: []
  }

  let sendSessionMessage: ((input: SessionBridgeMessageInput) => Promise<SessionBridgeMessageResult>) | null = null
  let fetchSessionEvents: ((cursor?: string | null) => Promise<SessionBridgeEventsResult>) | null = null

  const engineOptions = resolveEngineOptions(context.repoPath, options.engine)

  const resolveSessionBridge = async (): Promise<void> => {
    if (currentEngineStatus.state !== 'healthy' || !currentEngineStatus.endpoint) {
      currentSessionStatus = {
        state: 'disabled',
        activeSessionId: null,
        source: 'none',
        workspaceKey: `${context.repoId}::unbound`,
        endpoint: currentEngineStatus.endpoint,
        lastResolvedAt: new Date().toISOString(),
        message: 'Session bridge is waiting for an active OpenCode engine endpoint.',
        diagnostics: []
      }
      sendSessionMessage = null
      fetchSessionEvents = null
      return
    }

    const explicitSessionId = options.sessionId?.trim()
      || process.env.STEWARD_OPENCODE_SESSION_ID?.trim()
      || null

    const sessionBridge = await startSessionBridge({
      endpoint: currentEngineStatus.endpoint,
      repoId: context.repoId,
      repoPath: context.repoPath,
      explicitSessionId,
      fetchTimeoutMs: engineOptions.fetchTimeoutMs
    })

    currentSessionStatus = sessionBridge.getStatus()
    sendSessionMessage = sessionBridge.sendMessage
    fetchSessionEvents = sessionBridge.fetchEvents
  }

  if (shouldManageEngine) {
    engineHandle = await startOpenCodeEngineLifecycle(engineOptions)
    currentEngineStatus = engineHandle.getStatus()
  }

  await resolveSessionBridge()

  const getRuntimeState = (): RuntimeHostState => {
    if (engineHandle) {
      currentEngineStatus = engineHandle.getStatus()
    }

    return {
      mode: 'launcher',
      launcher: buildLauncherPayload(context, currentEngineStatus, currentSessionStatus)
    }
  }

  let actionInFlight: Promise<RuntimeHostState> | null = null

  const restartEngine = async (action: LauncherControlAction): Promise<RuntimeHostState> => {
    if (!shouldManageEngine) {
      throw new Error('Launcher engine lifecycle is disabled for this session.')
    }

    if (action === 'retry') {
      const snapshot = getRuntimeState()
      if (snapshot.launcher?.engine.state === 'healthy') {
        return snapshot
      }
    }

    if (engineHandle) {
      currentEngineStatus = await engineHandle.stop(`launcher action: ${action}`)
    }

    engineHandle = await startOpenCodeEngineLifecycle(engineOptions)
    currentEngineStatus = engineHandle.getStatus()
    await resolveSessionBridge()
    return getRuntimeState()
  }

  const runAction = async (action: LauncherControlAction): Promise<RuntimeHostState> => {
    if (actionInFlight) {
      return await actionInFlight
    }

    actionInFlight = (async () => {
      return await restartEngine(action)
    })().finally(() => {
      actionInFlight = null
    })

    return await actionInFlight
  }

  const controlServer: LauncherControlServerHandle = await startLauncherControlServer({
    getState: getRuntimeState,
    runAction,
    getSessionState: () => currentSessionStatus,
    sendSessionMessage: async (input) => {
      if (!sendSessionMessage) {
        throw new Error('Session bridge transport is not available')
      }

      return await sendSessionMessage(input)
    },
    fetchSessionEvents: async (cursor) => {
      if (!fetchSessionEvents) {
        throw new Error('Session bridge transport is not available')
      }

      return await fetchSessionEvents(cursor)
    }
  })

  const initialRuntimeState = getRuntimeState()
  const capabilities = initialRuntimeState.launcher?.capabilities || []
  const unavailableCount = capabilities.filter((capability) => !capability.available).length

  const logLines = [
    `Launcher context resolved: repo=${context.repoName} (${context.repoId})`,
    `Launcher PRD context: ${context.prdSlug || '<none>'} (${context.prdSource})`,
    `OpenCode engine state: ${currentEngineStatus.state}${currentEngineStatus.endpoint ? ` (${currentEngineStatus.endpoint})` : ''}`,
    `Session bridge state: ${currentSessionStatus.state}${currentSessionStatus.activeSessionId ? ` (${currentSessionStatus.activeSessionId})` : ''}`,
    `Launcher capabilities: ${capabilities.length - unavailableCount}/${capabilities.length} available`,
    `Launcher control endpoint: ${controlServer.url}`
  ]

  return {
    runtime: initialRuntimeState,
    logLines,
    control: {
      url: controlServer.url,
      token: controlServer.token
    },
    shutdown: async () => {
      try {
        await controlServer.close()
      } finally {
        if (!engineHandle) {
          return
        }

        currentEngineStatus = await engineHandle.stop('launcher ui exit')
      }
    }
  }
}
