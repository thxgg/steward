import type { SessionBridgeMessageInput } from '~~/app/types/launcher'
import {
  invokeLauncherSessionMessage,
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

function parseMessageInput(value: unknown): SessionBridgeMessageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid session message input'
    })
  }

  const body = value as {
    role?: unknown
    content?: unknown
  }

  if (body.role !== 'user' && body.role !== 'assistant' && body.role !== 'system') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session message role must be user, assistant, or system'
    })
  }

  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Session message content is required'
    })
  }

  return {
    role: body.role,
    content: body.content
  }
}

export default defineEventHandler(async (event) => {
  const input = parseMessageInput(await readBody(event))

  try {
    const result = await invokeLauncherSessionMessage(input)
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
