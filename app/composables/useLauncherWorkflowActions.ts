import type {
  LauncherUiError,
  LauncherUiErrorKind,
  SessionBridgeStatus,
  SessionBridgeEventsResult,
  SessionBridgeMessageResult
} from '~/types/launcher'
import {
  buildWorkflowCommand,
  canDispatchWorkflowAction,
  type WorkflowActionKind
} from '~/lib/launcher-workflow'

export type { WorkflowActionKind } from '~/lib/launcher-workflow'

type WorkflowStatus = 'idle' | 'running' | 'success' | 'error'

interface WorkflowRunState {
  status: WorkflowStatus
  action: WorkflowActionKind | null
  command: string | null
  message: string | null
  requestId: string | null
  updatedAt: string | null
}

const EVENT_POLL_ATTEMPTS = 4
const EVENT_POLL_DELAY_MS = 350

function createInitialState(): WorkflowRunState {
  return {
    status: 'idle',
    action: null,
    command: null,
    message: null,
    requestId: null,
    updatedAt: null
  }
}

function normalizeErrorKind(value: unknown): LauncherUiErrorKind {
  if (value === 'auth' || value === 'network' || value === 'process') {
    return value
  }

  return 'process'
}

function toUiError(error: unknown): LauncherUiError {
  const fetchError = error as {
    statusCode?: number
    data?: {
      kind?: unknown
      code?: unknown
      message?: unknown
    }
    statusMessage?: string
    message?: string
  }

  const statusCode = fetchError.statusCode
  const inferredKind: LauncherUiErrorKind = statusCode === 401 || statusCode === 403
    ? 'auth'
    : statusCode === 503
      ? 'network'
      : 'process'

  const kind = fetchError.data?.kind !== undefined
    ? normalizeErrorKind(fetchError.data.kind)
    : inferredKind
  const code = typeof fetchError.data?.code === 'string' && fetchError.data.code.trim().length > 0
    ? fetchError.data.code.trim()
    : 'LAUNCHER_WORKFLOW_ERROR'
  const message = typeof fetchError.data?.message === 'string' && fetchError.data.message.trim().length > 0
    ? fetchError.data.message.trim()
    : (fetchError.statusMessage || fetchError.message || 'Workflow action failed.')

  return {
    kind,
    code,
    message
  }
}

function formatErrorMessage(error: LauncherUiError): string {
  const labels: Record<LauncherUiErrorKind, string> = {
    process: 'Process error',
    auth: 'Auth error',
    network: 'Network error'
  }

  return `${labels[error.kind]} (${error.code}): ${error.message}`
}

export function useLauncherWorkflowActions() {
  const { hostMode } = useHostRuntime()

  const runState = useState<WorkflowRunState>('launcher-workflow-run-state', () => createInitialState())
  const inFlightAction = useState<WorkflowActionKind | null>('launcher-workflow-in-flight-action', () => null)
  const eventsCursor = useState<string | null>('launcher-workflow-events-cursor', () => null)

  const isLauncherMode = computed(() => hostMode.value === 'launcher')
  const isRunning = computed(() => inFlightAction.value !== null)

  function updateState(next: Partial<WorkflowRunState>) {
    runState.value = {
      ...runState.value,
      ...next,
      updatedAt: new Date().toISOString()
    }
  }

  async function getSessionState(): Promise<SessionBridgeStatus> {
    const response = await $fetch<{ ok: boolean; session: SessionBridgeStatus }>('/api/launcher/session')
    return response.session
  }

  async function pollSessionEvents(): Promise<number> {
    let observedEvents = 0

    for (let attempt = 0; attempt < EVENT_POLL_ATTEMPTS; attempt += 1) {
      const response = await $fetch<{ ok: boolean; result: SessionBridgeEventsResult }>('/api/launcher/session/events', {
        query: eventsCursor.value ? { cursor: eventsCursor.value } : undefined
      })

      const result = response.result
      eventsCursor.value = result.cursor || eventsCursor.value

      if (result.events.length > 0) {
        observedEvents += result.events.length
        break
      }

      if (attempt < EVENT_POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, EVENT_POLL_DELAY_MS)
        })
      }
    }

    return observedEvents
  }

  async function dispatch(action: WorkflowActionKind, prdSlug: string): Promise<void> {
    const normalizedSlug = prdSlug.trim()

    if (!isLauncherMode.value) {
      updateState({
        status: 'error',
        action,
        command: null,
        requestId: null,
        message: 'Workflow buttons require launcher mode with an active session bridge.'
      })
      return
    }

    if (normalizedSlug.length === 0) {
      updateState({
        status: 'error',
        action,
        command: null,
        requestId: null,
        message: 'PRD slug is required before dispatching workflow actions.'
      })
      return
    }

    if (!canDispatchWorkflowAction(inFlightAction.value)) {
      return
    }

    const command = buildWorkflowCommand(action, normalizedSlug)

    inFlightAction.value = action
    updateState({
      status: 'running',
      action,
      command,
      requestId: null,
      message: `Dispatching ${command}...`
    })

    try {
      const session = await getSessionState()
      if (session.state !== 'ready' || !session.activeSessionId) {
        throw new Error(session.message || 'Session bridge is not ready for workflow commands.')
      }

      const response = await $fetch<{ ok: boolean; result: SessionBridgeMessageResult }>('/api/launcher/session/message', {
        method: 'POST',
        body: {
          role: 'user',
          content: command
        }
      })

      const observedEvents = await pollSessionEvents()
      const completionDetail = observedEvents > 0
        ? `Bridge reported ${observedEvents} follow-up event${observedEvents === 1 ? '' : 's'}.`
        : 'Command accepted; waiting for additional bridge events.'

      updateState({
        status: 'success',
        action,
        command,
        requestId: response.result.requestId,
        message: `Dispatched to session ${response.result.sessionId}. ${completionDetail}`
      })
    } catch (error) {
      const normalized = toUiError(error)
      updateState({
        status: 'error',
        action,
        command,
        requestId: null,
        message: formatErrorMessage(normalized)
      })
    } finally {
      inFlightAction.value = null
    }
  }

  async function runBreakIntoTasks(prdSlug: string): Promise<void> {
    await dispatch('break_into_tasks', prdSlug)
  }

  async function runCompleteNextTask(prdSlug: string): Promise<void> {
    await dispatch('complete_next_task', prdSlug)
  }

  return {
    runState,
    inFlightAction,
    isLauncherMode,
    isRunning,
    runBreakIntoTasks,
    runCompleteNextTask
  }
}
