import { addRepo, validateRepoPath } from '~~/server/utils/repos'
import type { AddRepoRequest } from '~~/app/types/repo'

export default defineEventHandler(async (event) => {
  const body = await readBody<AddRepoRequest>(event)

  if (!body?.path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Path is required'
    })
  }

  const validation = await validateRepoPath(body.path)
  if (!validation.valid) {
    throw createError({
      statusCode: 400,
      statusMessage: validation.error || 'Invalid path'
    })
  }

  try {
    const repo = await addRepo(body.path, body.name)
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
