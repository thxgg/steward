import { getRepos, saveRepos, discoverGitRepos } from '~~/server/utils/repos'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required',
    })
  }

  const repos = await getRepos()
  const repoIndex = repos.findIndex(r => r.id === repoId)

  if (repoIndex === -1) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found',
    })
  }

  const repo = repos[repoIndex]!

  // Re-discover git repos
  const gitRepos = await discoverGitRepos(repo.path)

  // Update the repo config
  if (gitRepos.length > 0) {
    repo.gitRepos = gitRepos
  } else {
    delete repo.gitRepos
  }

  repos[repoIndex] = repo
  await saveRepos(repos)

  return {
    discovered: gitRepos.length,
    gitRepos,
  }
})
