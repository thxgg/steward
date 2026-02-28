import type { LauncherHostState, RuntimeHostState } from '../../../app/types/launcher.js'
import { detectLauncherCapabilities } from './capabilities.js'
import { HOST_BOUNDARY_CONTRACT } from './contract.js'
import { resolveLauncherContext, type ResolveLauncherContextOptions } from './context.js'

export interface LauncherBootstrapResult {
  runtime: RuntimeHostState
  logLines: string[]
}

function buildWarnings(payload: LauncherHostState): string[] {
  const warnings = [...payload.warnings]

  if (!payload.context?.prdSlug) {
    warnings.push('No PRD was auto-resolved for this workspace. The UI will start at repository scope.')
  }

  return [...new Set(warnings)]
}

export async function bootstrapLauncher(
  options: ResolveLauncherContextOptions = {}
): Promise<LauncherBootstrapResult> {
  const context = await resolveLauncherContext(options)
  const capabilities = detectLauncherCapabilities()

  const launcherPayload: LauncherHostState = {
    context,
    capabilities,
    warnings: [],
    contract: HOST_BOUNDARY_CONTRACT
  }

  launcherPayload.warnings = buildWarnings(launcherPayload)

  const unavailableCount = capabilities.filter((capability) => !capability.available).length

  const logLines = [
    `Launcher context resolved: repo=${context.repoName} (${context.repoId})`,
    `Launcher PRD context: ${context.prdSlug || '<none>'} (${context.prdSource})`,
    `Launcher capabilities: ${capabilities.length - unavailableCount}/${capabilities.length} available`
  ]

  return {
    runtime: {
      mode: 'launcher',
      launcher: launcherPayload
    },
    logLines
  }
}
