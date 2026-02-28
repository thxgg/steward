import {
  invokeLauncherTerminalAttach,
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
  const body = await readBody<{ rows?: unknown; cols?: unknown }>(event)

  const rows = typeof body?.rows === 'number' && Number.isFinite(body.rows) && body.rows > 0
    ? Math.floor(body.rows)
    : undefined
  const cols = typeof body?.cols === 'number' && Number.isFinite(body.cols) && body.cols > 0
    ? Math.floor(body.cols)
    : undefined

  try {
    const result = await invokeLauncherTerminalAttach({ rows, cols })

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
