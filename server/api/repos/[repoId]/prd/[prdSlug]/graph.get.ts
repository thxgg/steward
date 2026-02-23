import { getRepos } from '~~/server/utils/repos'
import { buildPrdGraph } from '~~/server/utils/task-graph'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')

  if (!repoId || !prdSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID and PRD slug are required'
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
    return await buildPrdGraph(repo, prdSlug)
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to build PRD graph',
      message: (error as Error).message.replace(/\s+/g, ' ').trim()
    })
  }
})
