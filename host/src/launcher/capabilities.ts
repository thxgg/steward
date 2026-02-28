import { spawnSync } from 'node:child_process'
import type {
  HostCapabilityFlag,
  OpenCodeEngineStatus,
  SessionBridgeStatus
} from '../../../app/types/launcher.js'

function commandAvailable(command: string, args: string[] = ['--version']): boolean {
  try {
    const result = spawnSync(command, args, {
      stdio: 'ignore'
    })

    return result.status === 0
  } catch {
    return false
  }
}

function describeEngineLifecycle(engine: OpenCodeEngineStatus): {
  available: boolean
  detail: string
  action?: string
} {
  if (engine.state === 'healthy') {
    if (engine.reused) {
      return {
        available: true,
        detail: engine.endpoint
          ? `Reusing healthy OpenCode endpoint at ${engine.endpoint}.`
          : 'Reusing healthy OpenCode endpoint.'
      }
    }

    return {
      available: true,
      detail: engine.endpoint
        ? `Managed OpenCode engine is healthy at ${engine.endpoint}.`
        : 'Managed OpenCode engine is healthy.'
    }
  }

  if (engine.state === 'starting') {
    return {
      available: false,
      detail: engine.message,
      action: 'Wait for startup polling to finish before retrying lifecycle-dependent actions.'
    }
  }

  if (engine.state === 'degraded') {
    return {
      available: false,
      detail: engine.message,
      action: engine.diagnostics[0]
        ? `Review diagnostics: ${engine.diagnostics[0]}`
        : 'Check OpenCode command/endpoint settings and retry launcher startup.'
    }
  }

  return {
    available: false,
    detail: engine.message,
    action: 'Restart launcher mode to initialize OpenCode lifecycle management.'
  }
}

function describeSessionBridge(session: SessionBridgeStatus): {
  available: boolean
  detail: string
  action?: string
} {
  if (session.state === 'ready') {
    return {
      available: true,
      detail: session.activeSessionId
        ? `Active session ${session.activeSessionId} (${session.source}) is bound for workspace routing.`
        : session.message
    }
  }

  if (session.state === 'degraded') {
    return {
      available: false,
      detail: session.message,
      action: session.diagnostics[0]
        ? `Review session diagnostics: ${session.diagnostics[0]}`
        : 'Retry session bridge resolution after engine reconnect.'
    }
  }

  return {
    available: false,
    detail: session.message,
    action: 'Start launcher mode with an active OpenCode engine to initialize session bridge routing.'
  }
}

function describeWorkflowActions(session: SessionBridgeStatus): {
  available: boolean
  detail: string
  action?: string
} {
  if (session.state === 'ready' && session.activeSessionId) {
    return {
      available: true,
      detail: `Workflow buttons dispatch to active session ${session.activeSessionId}.`
    }
  }

  if (session.state === 'degraded') {
    return {
      available: false,
      detail: 'Workflow buttons are disabled until session bridge is healthy.',
      action: session.message
    }
  }

  return {
    available: false,
    detail: 'Workflow buttons require an active session bridge.',
    action: 'Wait for session bridge initialization before using launcher workflow actions.'
  }
}

export function detectLauncherCapabilities(
  engine: OpenCodeEngineStatus,
  session: SessionBridgeStatus
): HostCapabilityFlag[] {
  const hasOpenCodeCli = commandAvailable('opencode')
  const engineLifecycle = describeEngineLifecycle(engine)
  const sessionBridge = describeSessionBridge(session)
  const workflowActions = describeWorkflowActions(session)

  return [
    {
      id: 'workspaceContext',
      label: 'Workspace context bootstrap',
      available: true,
      detail: 'Repository and PRD context are resolved at host startup before UI initialization.'
    },
    {
      id: 'opencodeCli',
      label: 'OpenCode CLI detection',
      available: hasOpenCodeCli,
      detail: hasOpenCodeCli
        ? 'OpenCode CLI is available on PATH.'
        : 'OpenCode CLI is not currently available on PATH.',
      action: hasOpenCodeCli
        ? undefined
        : 'Install or expose `opencode` on PATH before enabling managed engine lifecycle.'
    },
    {
      id: 'engineLifecycle',
      label: 'Engine lifecycle manager',
      available: engineLifecycle.available,
      detail: engineLifecycle.detail,
      action: engineLifecycle.action
    },
    {
      id: 'sessionBridge',
      label: 'Active session bridge',
      available: sessionBridge.available,
      detail: sessionBridge.detail,
      action: sessionBridge.action
    },
    {
      id: 'workflowActions',
      label: 'In-UI workflow buttons',
      available: workflowActions.available,
      detail: workflowActions.detail,
      action: workflowActions.action
    },
    {
      id: 'terminalEmbedding',
      label: 'libghostty terminal embedding',
      available: false,
      detail: 'Terminal embedding via libghostty is not wired yet.',
      action: 'Use an external terminal attached to your OpenCode session until terminal integration is implemented.'
    }
  ]
}
