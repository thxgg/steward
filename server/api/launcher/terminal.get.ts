import {
  fetchLauncherTerminalState,
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

export default defineEventHandler(async () => {
  try {
    const terminal = await fetchLauncherTerminalState()

    return {
      ok: true,
      terminal
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
