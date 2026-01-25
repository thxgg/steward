import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getCommitInfo } from '~~/server/utils/git'
import type { GitCommit } from '~/types/git'

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

  // Get SHAs from query parameter
  const query = getQuery(event)
  const shasParam = query.shas as string | undefined

  if (!shasParam) {
    throw createError({
      statusCode: 400,
      statusMessage: 'shas query parameter is required',
    })
  }

  const shas = shasParam.split(',').map(s => s.trim()).filter(Boolean)

  if (shas.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one SHA is required',
    })
  }

  // Fetch commit info for each SHA
  const commits: GitCommit[] = []
  const errors: string[] = []

  for (const sha of shas) {
    try {
      const commit = await getCommitInfo(repo.path, sha)
      commits.push(commit)
    } catch (error) {
      errors.push(`${sha}: ${(error as Error).message}`)
    }
  }

  // If all commits failed, throw error
  if (commits.length === 0 && errors.length > 0) {
    throw createError({
      statusCode: 404,
      statusMessage: `No valid commits found: ${errors.join('; ')}`,
    })
  }

  return commits
})
