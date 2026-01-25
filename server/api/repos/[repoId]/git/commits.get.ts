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

  // Get query parameters
  const query = getQuery(event)
  const shasParam = query.shas as string | undefined
  const repoPath = query.repo as string | undefined

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

  // Resolve the git repo path
  let gitRepoPath = repo.path

  if (repoPath) {
    // Validate that repoPath is within discovered gitRepos
    if (!repo.gitRepos || repo.gitRepos.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'repo parameter provided but no git repos discovered in this repository',
      })
    }

    const matchedRepo = repo.gitRepos.find(gr => gr.relativePath === repoPath)
    if (!matchedRepo) {
      throw createError({
        statusCode: 400,
        statusMessage: `repo "${repoPath}" is not a discovered git repo. Available: ${repo.gitRepos.map(gr => gr.relativePath).join(', ')}`,
      })
    }

    gitRepoPath = matchedRepo.absolutePath
  }

  // Check if resolved path is a git repository
  if (!await isGitRepo(gitRepoPath)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Resolved path is not a git repository',
    })
  }

  // Fetch commit info for each SHA
  const commits: GitCommit[] = []
  const errors: string[] = []

  for (const sha of shas) {
    try {
      const commit = await getCommitInfo(gitRepoPath, sha)
      // Add repoPath to the response
      commits.push({
        ...commit,
        repoPath: repoPath || '',
      })
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
