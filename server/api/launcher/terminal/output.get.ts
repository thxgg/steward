import {
  fetchLauncherTerminalOutput,
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
  const query = getQuery(event)
  const rawCursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor
  const cursor = typeof rawCursor === 'string' ? rawCursor : undefined

  try {
    const result = await fetchLauncherTerminalOutput(cursor)

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
