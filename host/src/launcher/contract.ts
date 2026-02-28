import type { HostBoundaryContract } from '../../../app/types/launcher.js'

export const HOST_BOUNDARY_CONTRACT: HostBoundaryContract = {
  host: [
    'Resolve repository and PRD context before UI startup.',
    'Detect native runtime capabilities and surface availability.',
    'Own process-level service orchestration for desktop integrations.'
  ],
  ui: [
    'Render launcher context and capability state to users.',
    'Disable unavailable native actions with actionable guidance.',
    'Preserve existing web-only behavior when launcher data is absent.'
  ]
}
