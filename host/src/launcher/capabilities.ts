import { spawnSync } from 'node:child_process'
import type { HostCapabilityFlag, OpenCodeEngineStatus } from '../../../app/types/launcher.js'

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

export function detectLauncherCapabilities(engine: OpenCodeEngineStatus): HostCapabilityFlag[] {
  const hasOpenCodeCli = commandAvailable('opencode')
  const engineLifecycle = describeEngineLifecycle(engine)

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
      available: false,
      detail: 'Session identity routing between host services and UI is not wired yet.',
      action: 'Avoid assuming terminal and workflow actions target a shared session until session bridge is added.'
    },
    {
      id: 'workflowActions',
      label: 'In-UI workflow buttons',
      available: false,
      detail: 'Launcher-scoped `/steward:break_into_tasks` and `/steward:complete_next_task` controls are not wired yet.',
      action: 'Run workflow prompts from your MCP client for now.'
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
