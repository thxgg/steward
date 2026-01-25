import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getCommitDiff } from '~~/server/utils/git'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required',
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found',
    })
  }

  // Check if it's a git repository
  if (!await isGitRepo(repo.path)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository is not a git repository',
    })
  }

  // Get commit SHA from query parameter
  const query = getQuery(event)
  const commit = query.commit as string | undefined

  if (!commit) {
    throw createError({
      statusCode: 400,
      statusMessage: 'commit query parameter is required',
    })
  }

  try {
    const files = await getCommitDiff(repo.path, commit)
    return files
  } catch (error) {
    throw createError({
      statusCode: 404,
      statusMessage: `Commit not found or invalid: ${(error as Error).message}`,
    })
  }
})
