import { getRepos } from '~~/server/utils/repos'
import { getPrdState, migrateLegacyStateForRepo } from '~~/server/utils/prd-state'

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
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  await migrateLegacyStateForRepo(repo)

  try {
    const state = await getPrdState(repo.id, prdSlug)
    return state?.progress ?? null
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to read progress state',
      message: (error as Error).message.replace(/\s+/g, ' ').trim()
    })
  }
})
