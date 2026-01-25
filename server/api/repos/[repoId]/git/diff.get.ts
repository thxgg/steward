import { join } from 'node:path'
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

  // Get query parameters
  const query = getQuery(event)
  const commit = query.commit as string | undefined
  const repoPath = query.repo as string | undefined

  if (!commit) {
    throw createError({
      statusCode: 400,
      statusMessage: 'commit query parameter is required',
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

  try {
    const files = await getCommitDiff(gitRepoPath, commit)
    return files
  } catch (error) {
    throw createError({
      statusCode: 404,
      statusMessage: `Commit not found or invalid: ${(error as Error).message}`,
    })
  }
})
