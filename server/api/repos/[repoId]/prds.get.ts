import { listPrdDocuments } from '~~/server/utils/prd-service'
import { getRepoById } from '~~/server/utils/repos'

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required'
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
    return await listPrdDocuments(repo)
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to load PRD list',
      message: normalizeErrorMessage((error as Error).message)
    })
  }
})
