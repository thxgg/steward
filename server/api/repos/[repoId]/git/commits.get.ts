import { getRepos } from '~~/server/utils/repos'
import { findRepoForCommit, getCommitInfo, isGitRepo } from '~~/server/utils/git'
import {
  buildRepoLookup,
  getRepoRelativePath,
  normalizeErrorMessage,
  parseCommitShaListParam,
  parseOptionalGitRepoPathParam,
  resolveRequestedGitRepoPath,
} from '~~/server/utils/git-api'
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
  let shas: string[]
  let repoPath: string | undefined

  try {
    shas = parseCommitShaListParam(query.shas)
    repoPath = parseOptionalGitRepoPathParam(query.repo)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid git query parameters',
      message: normalizeErrorMessage((error as Error).message),
    })
  }

  const repoLookup = await buildRepoLookup(repo)

  let fixedGitRepoPath: string | null = null
  let fixedRepoPath = ''

  if (repoPath) {
    try {
      const resolved = await resolveRequestedGitRepoPath(repoLookup, repoPath)
      fixedGitRepoPath = resolved.gitRepoPath
      fixedRepoPath = resolved.normalizedRepoPath
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid repo path',
        message: normalizeErrorMessage((error as Error).message),
      })
    }
  } else if (await isGitRepo(repo.path)) {
    fixedGitRepoPath = repo.path
    fixedRepoPath = ''
  }

  // Fetch commit info for each SHA in parallel.
  const commitResults = await Promise.all(shas.map(async (sha) => {
    try {
      let gitRepoPathForCommit = fixedGitRepoPath
      let resolvedRepoPath = fixedRepoPath

      if (!gitRepoPathForCommit) {
        const resolved = await findRepoForCommit(repoLookup, sha)
        gitRepoPathForCommit = resolved.absolutePath
        resolvedRepoPath = resolved.repoPath
      }

      let commit: GitCommit

      try {
        commit = await getCommitInfo(gitRepoPathForCommit, sha)
      } catch (error) {
        if (!fixedGitRepoPath) {
          throw error
        }

        const fallback = await findRepoForCommit(repoLookup, sha).catch(() => null)
        if (!fallback || fallback.absolutePath === gitRepoPathForCommit) {
          throw error
        }

        commit = await getCommitInfo(fallback.absolutePath, sha)
        resolvedRepoPath = fallback.repoPath
        gitRepoPathForCommit = fallback.absolutePath
      }

      return {
        commit: {
          ...commit,
          repoPath: resolvedRepoPath || getRepoRelativePath(repo.path, gitRepoPathForCommit),
        },
        error: null
      }
    } catch (error) {
      return {
        commit: null,
        error: `${sha}: ${normalizeErrorMessage((error as Error).message)}`
      }
    }
  }))

  const commits: GitCommit[] = commitResults.flatMap((result) => {
    return result.commit ? [result.commit] : []
  })
  const errors = commitResults
    .map((result) => result.error)
    .filter((message): message is string => message !== null)

  // If all commits failed, throw error
  if (commits.length === 0 && errors.length > 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No valid commits found',
      message: `No valid commits found: ${errors.join('; ')}`,
    })
  }

  return commits
})
