import { discoverGitRepos, getRepoById, updateRepoGitRepos } from '~~/server/utils/repos'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required',
    })
  }

  const repo = await getRepoById(repoId)
  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found',
    })
  }

  // Re-discover git repos
  const gitRepos = await discoverGitRepos(repo.path)

  await updateRepoGitRepos(repo.id, gitRepos.length > 0 ? gitRepos : undefined)

  return {
    discovered: gitRepos.length,
    gitRepos,
  }
})
