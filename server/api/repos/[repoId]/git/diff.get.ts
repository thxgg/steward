import { getRepos } from '~~/server/utils/repos'
import { findRepoForCommit, getCommitDiff, isGitRepo } from '~~/server/utils/git'
import {
  buildRepoLookup,
  normalizeErrorMessage,
  parseCommitShaParam,
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
  let repoPath: string | undefined

  try {
    commit = parseCommitShaParam(query.commit, 'commit query parameter')
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

  try {
    const files = await getCommitDiff(gitRepoPath, commit)
    return files
  } catch (error) {
    const message = normalizeErrorMessage((error as Error).message)

    const fallback = await findRepoForCommit(repoLookup, commit).catch(() => null)
    if (fallback && fallback.absolutePath !== gitRepoPath) {
      try {
        return await getCommitDiff(fallback.absolutePath, commit)
      } catch {
        // Keep original error below for clearer context.
      }
    }

    const isInvalidCommit = message.startsWith('Invalid commit SHA')

    throw createError({
      statusCode: isInvalidCommit ? 400 : 404,
      statusMessage: isInvalidCommit ? 'Invalid commit SHA' : 'Commit not found or invalid',
      message,
    })
  }
})
