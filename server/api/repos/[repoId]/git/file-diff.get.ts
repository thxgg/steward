import { getRepos } from '~~/server/utils/repos'
import { findRepoForCommit, getFileDiff, isGitRepo, validatePathInRepo } from '~~/server/utils/git'
import {
  buildRepoLookup,
  normalizeErrorMessage,
  parseCommitShaParam,
  parseGitFilePathParam,
  parseOptionalGitRepoPathParam,
  resolveRequestedGitRepoPath,
} from '~~/server/utils/git-api'

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
  let commit: string
  let file: string
  let repoPath: string | undefined

  try {
    commit = parseCommitShaParam(query.commit, 'commit query parameter')
    file = parseGitFilePathParam(query.file)
    repoPath = parseOptionalGitRepoPathParam(query.repo)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid git query parameters',
      message: normalizeErrorMessage((error as Error).message),
    })
  }

  const repoLookup = await buildRepoLookup(repo)

  let gitRepoPath = repo.path
  if (repoPath) {
    try {
      const resolved = await resolveRequestedGitRepoPath(repoLookup, repoPath)
      gitRepoPath = resolved.gitRepoPath
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid repo path',
        message: normalizeErrorMessage((error as Error).message),
      })
    }
  }

  if (!await isGitRepo(gitRepoPath)) {
    const fallback = await findRepoForCommit(repoLookup, commit).catch(() => null)
    if (!fallback) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Resolved path is not a git repository',
      })
    }
    gitRepoPath = fallback.absolutePath
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
    const message = normalizeErrorMessage((error as Error).message)

    const fallback = await findRepoForCommit(repoLookup, commit).catch(() => null)
    if (fallback && fallback.absolutePath !== gitRepoPath && validatePathInRepo(fallback.absolutePath, file)) {
      try {
        return await getFileDiff(fallback.absolutePath, commit, file)
      } catch {
        // Keep original error below for clearer context.
      }
    }

    // Determine appropriate error code
    if (message.includes('Invalid commit SHA')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid commit SHA',
        message,
      })
    }

    if (message.includes('outside repository')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid file path',
        message,
      })
    }

    throw createError({
      statusCode: 404,
      statusMessage: 'File not found in commit or commit invalid',
      message,
    })
  }
})
