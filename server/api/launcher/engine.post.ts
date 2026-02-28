import type { LauncherControlAction } from '~~/app/types/launcher'
import { invokeLauncherAction, toLauncherUiError } from '~~/server/utils/launcher-control'

function isLauncherControlAction(value: unknown): value is LauncherControlAction {
  return value === 'retry' || value === 'reconnect' || value === 'restart'
}

function statusCodeForKind(kind: 'process' | 'auth' | 'network'): number {
  if (kind === 'auth') {
    return 401
  }

  if (kind === 'network') {
    return 503
  }

  return 500
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: unknown }>(event)

  if (!isLauncherControlAction(body?.action)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid launcher action',
      data: {
        kind: 'process',
        code: 'LAUNCHER_CONTROL_INVALID_ACTION',
        message: 'Action must be one of: retry, reconnect, restart.'
      }
    })
  }

  try {
    const host = await invokeLauncherAction(body.action)
    return {
      ok: true,
      host
    }
  } catch (error) {
    const normalized = toLauncherUiError(error)

    throw createError({
      statusCode: statusCodeForKind(normalized.kind),
      statusMessage: normalized.message,
      data: normalized
    })
  }
})
