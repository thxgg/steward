import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getFileDiff, validatePathInRepo } from '~~/server/utils/git'

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
  const file = query.file as string | undefined
  const repoPath = query.repo as string | undefined

  if (!commit) {
    throw createError({
      statusCode: 400,
      statusMessage: 'commit query parameter is required',
    })
  }

  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'file query parameter is required',
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

  // Validate file path is within repo
  if (!validatePathInRepo(gitRepoPath, file)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file path: path traversal not allowed',
    })
  }

  try {
    const hunks = await getFileDiff(gitRepoPath, commit, file)
    return hunks
  } catch (error) {
    const message = (error as Error).message

    // Determine appropriate error code
    if (message.includes('Invalid commit SHA')) {
      throw createError({
        statusCode: 400,
        statusMessage: message,
      })
    }

    if (message.includes('outside repository')) {
      throw createError({
        statusCode: 400,
        statusMessage: message,
      })
    }

    throw createError({
      statusCode: 404,
      statusMessage: `File not found in commit or commit invalid: ${message}`,
    })
  }
})
