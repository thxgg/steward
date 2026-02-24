import { addRepo, validateRepoPath } from '~~/server/utils/repos'
import { refreshWatcher } from '~~/server/utils/watcher'
import type { AddRepoRequest } from '~~/app/types/repo'
import { z } from 'zod'

const addRepoBodySchema = z.object({
  path: z.string().trim().min(1, 'Path is required').max(4096, 'Path is too long'),
  name: z.string().trim().max(256, 'Name is too long').optional()
}).strict()

function getValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid request body'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event)
  const parsedBody = addRepoBodySchema.safeParse(body)

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      message: getValidationMessage(parsedBody.error)
    })
  }

  const normalizedBody: AddRepoRequest = {
    path: parsedBody.data.path,
    ...(parsedBody.data.name && parsedBody.data.name.length > 0 && { name: parsedBody.data.name })
  }

  const validation = await validateRepoPath(normalizedBody.path)
  if (!validation.valid) {
    throw createError({
      statusCode: 400,
      statusMessage: validation.error || 'Invalid path'
    })
  }

  try {
    const repo = await addRepo(normalizedBody.path, normalizedBody.name)
    // Refresh file watcher to include new repo
    await refreshWatcher()
    return repo
  } catch (error) {
    if (error instanceof Error && error.message === 'Repository already added') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Repository already added'
      })
    }
    throw error
  }
})
