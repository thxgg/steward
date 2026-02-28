export type WorkflowActionKind = 'break_into_tasks' | 'complete_next_task'

export function buildWorkflowCommand(action: WorkflowActionKind, prdSlug: string): string {
  const normalizedSlug = prdSlug.trim()

  if (action === 'break_into_tasks') {
    return `/steward:break_into_tasks ${normalizedSlug}`
  }

  return `/steward:complete_next_task ${normalizedSlug}`
}

export function canDispatchWorkflowAction(inFlightAction: WorkflowActionKind | null): boolean {
  return inFlightAction === null
}
