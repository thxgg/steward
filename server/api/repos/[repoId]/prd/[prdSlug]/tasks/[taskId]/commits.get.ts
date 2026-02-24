import { resolveTaskCommits } from '~~/server/utils/prd-service'
import { getRepoById } from '~~/server/utils/repos'

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')
  const taskId = getRouterParam(event, 'taskId')

  if (!repoId || !prdSlug || !taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID, PRD slug, and task ID are required'
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
    return await resolveTaskCommits(repo, prdSlug, taskId)
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
      statusMessage: 'Failed to resolve task commits',
      message
    })
  }
})
