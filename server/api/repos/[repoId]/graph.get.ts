import { getRepos } from '~~/server/utils/repos'
import { buildRepoGraph } from '~~/server/utils/task-graph'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required'
    })
  }

  const repos = await getRepos()
  const repo = repos.find((entry) => entry.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  try {
    return await buildRepoGraph(repo)
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to build repository graph',
      message: (error as Error).message.replace(/\s+/g, ' ').trim()
    })
  }
})
