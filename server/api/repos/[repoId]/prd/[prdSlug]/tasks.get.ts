import { readPrdTasks } from '~~/server/utils/prd-service'
import { getRepoById } from '~~/server/utils/repos'

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')

  if (!repoId || !prdSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID and PRD slug are required'
    })
  }

  const repo = await getRepoById(repoId)
  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  try {
    return await readPrdTasks(repo, prdSlug)
  } catch (error) {
    const message = normalizeErrorMessage((error as Error).message)

    if (message.includes('Invalid PRD slug')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid PRD slug',
        message
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to read task state',
      message
    })
  }
})
