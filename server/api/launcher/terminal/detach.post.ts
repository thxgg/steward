import {
  invokeLauncherTerminalDetach,
  toLauncherUiError
} from '~~/server/utils/launcher-control'

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
  const body = await readBody<{ reason?: unknown }>(event)
  const reason = typeof body?.reason === 'string' && body.reason.trim().length > 0
    ? body.reason.trim()
    : undefined

  try {
    const result = await invokeLauncherTerminalDetach(reason)

    return {
      ok: true,
      result
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
