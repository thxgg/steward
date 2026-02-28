import {
  invokeLauncherTerminalInput,
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
  const body = await readBody<{ input?: unknown }>(event)

  if (typeof body?.input !== 'string' || body.input.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Terminal input is required'
    })
  }

  try {
    const result = await invokeLauncherTerminalInput(body.input)

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
