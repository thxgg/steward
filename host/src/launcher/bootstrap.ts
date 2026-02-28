import type {
  LauncherControlAction,
  LauncherHostState,
  OpenCodeEngineStatus,
  SessionBridgeEventsResult,
  SessionBridgeMessageInput,
  SessionBridgeMessageResult,
  SessionBridgeStatus,
  TerminalAttachResult,
  TerminalBridgeStatus,
  TerminalDetachResult,
  TerminalInputResult,
  TerminalOutputResult,
  TerminalResizeResult,
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
import { createLauncherTerminalBridge, type LauncherTerminalBridgeHandle } from './terminal-bridge.js'

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

function parseBooleanFlag(rawValue: string | undefined): boolean | undefined {
  if (!rawValue) {
    return undefined
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }

  return undefined
}

function resolveEngineOptions(
  repoPath: string,
  overrides?: Omit<OpenCodeEngineLifecycleOptions, 'cwd'>
): OpenCodeEngineLifecycleOptions {
  const configuredEndpoint = process.env.STEWARD_OPENCODE_URL || process.env.OPENCODE_URL || undefined
  const localEndpoint = process.env.STEWARD_OPENCODE_LOCAL_URL || process.env.STEWARD_OPENCODE_ENDPOINT || undefined
  const command = process.env.STEWARD_OPENCODE_COMMAND || undefined
  const args = parseEngineArgs(process.env.STEWARD_OPENCODE_ARGS)
  const allowRemote = parseBooleanFlag(process.env.STEWARD_OPENCODE_ALLOW_REMOTE)

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
    allowRemote,
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

  if (payload.terminal.state === 'degraded') {
    warnings.push(payload.terminal.message)
  }

  return [...new Set(warnings)]
}

function buildLauncherPayload(
  context: LauncherHostState['context'],
  engine: OpenCodeEngineStatus,
  session: SessionBridgeStatus,
  terminal: TerminalBridgeStatus
): LauncherHostState {
  const capabilities = detectLauncherCapabilities(engine, session, terminal)

  const payload: LauncherHostState = {
    context,
    engine,
    session,
    terminal,
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
  let currentTerminalStatus: TerminalBridgeStatus = {
    renderer: 'libghostty',
    state: 'disabled',
    sessionId: null,
    activeSessionId: null,
    requiresReattach: false,
    rows: 24,
    cols: 80,
    scrollbackLimit: 1000,
    attachedAt: null,
    detachedAt: null,
    message: 'libghostty terminal bridge is waiting for session routing.',
    diagnostics: []
  }

  let sendSessionMessage: ((input: SessionBridgeMessageInput) => Promise<SessionBridgeMessageResult>) | null = null
  let fetchSessionEvents: ((cursor?: string | null) => Promise<SessionBridgeEventsResult>) | null = null
  let terminalBridge: LauncherTerminalBridgeHandle | null = null

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
      authToken: engineHandle?.getAuthToken() || undefined,
      fetchTimeoutMs: engineOptions.fetchTimeoutMs
    })

    currentSessionStatus = sessionBridge.getStatus()
    sendSessionMessage = sessionBridge.sendMessage
    fetchSessionEvents = sessionBridge.fetchEvents
  }

  const resolveTerminalBridge = (): void => {
    const previousRows = currentTerminalStatus.rows
    const previousCols = currentTerminalStatus.cols
    const previousScrollback = currentTerminalStatus.scrollbackLimit

    terminalBridge = createLauncherTerminalBridge({
      getSessionStatus: () => currentSessionStatus,
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
      },
      rows: previousRows,
      cols: previousCols,
      scrollbackLimit: previousScrollback
    })

    currentTerminalStatus = terminalBridge.getStatus()
  }

  const attachTerminalBaseline = async (): Promise<void> => {
    if (!terminalBridge) {
      return
    }

    const result = await terminalBridge.attach({
      rows: currentTerminalStatus.rows,
      cols: currentTerminalStatus.cols
    })
    currentTerminalStatus = result.terminal
  }

  if (shouldManageEngine) {
    engineHandle = await startOpenCodeEngineLifecycle(engineOptions)
    currentEngineStatus = engineHandle.getStatus()
  }

  await resolveSessionBridge()
  resolveTerminalBridge()
  await attachTerminalBaseline()

  const getRuntimeState = (): RuntimeHostState => {
    if (engineHandle) {
      currentEngineStatus = engineHandle.getStatus()
    }

    if (terminalBridge) {
      currentTerminalStatus = terminalBridge.getStatus()
    }

    return {
      mode: 'launcher',
      launcher: buildLauncherPayload(context, currentEngineStatus, currentSessionStatus, currentTerminalStatus)
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
    resolveTerminalBridge()
    await attachTerminalBaseline()
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
    },
    getTerminalState: () => {
      if (terminalBridge) {
        currentTerminalStatus = terminalBridge.getStatus()
      }

      return currentTerminalStatus
    },
    attachTerminal: async (attachOptions): Promise<TerminalAttachResult> => {
      if (!terminalBridge) {
        throw new Error('Terminal bridge is not available')
      }

      const result = await terminalBridge.attach(attachOptions)
      currentTerminalStatus = result.terminal
      return result
    },
    detachTerminal: async (reason): Promise<TerminalDetachResult> => {
      if (!terminalBridge) {
        throw new Error('Terminal bridge is not available')
      }

      const result = await terminalBridge.detach(reason)
      currentTerminalStatus = result.terminal
      return result
    },
    sendTerminalInput: async (input): Promise<TerminalInputResult> => {
      if (!terminalBridge) {
        throw new Error('Terminal bridge is not available')
      }

      const result = await terminalBridge.sendInput(input)
      currentTerminalStatus = result.terminal
      return result
    },
    resizeTerminal: async (rows, cols): Promise<TerminalResizeResult> => {
      if (!terminalBridge) {
        throw new Error('Terminal bridge is not available')
      }

      const result = await terminalBridge.resize(rows, cols)
      currentTerminalStatus = result.terminal
      return result
    },
    fetchTerminalOutput: async (cursor): Promise<TerminalOutputResult> => {
      if (!terminalBridge) {
        throw new Error('Terminal bridge is not available')
      }

      const result = await terminalBridge.fetchOutput(cursor)
      currentTerminalStatus = result.terminal
      return result
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
    `Terminal bridge state: ${currentTerminalStatus.state}${currentTerminalStatus.sessionId ? ` (${currentTerminalStatus.sessionId})` : ''}`,
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
