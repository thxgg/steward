import { getRepos } from '~~/server/utils/repos'
import { findRepoForCommit, getCommitInfo, isGitRepo } from '~~/server/utils/git'
import {
  buildRepoLookup,
  getRepoRelativePath,
  normalizeErrorMessage,
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

  // Fetch commit info for each SHA
  const commits: GitCommit[] = []
  const errors: string[] = []

  for (const sha of shas) {
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

      commits.push({
        ...commit,
        repoPath: resolvedRepoPath || getRepoRelativePath(repo.path, gitRepoPathForCommit),
      })
    } catch (error) {
      errors.push(`${sha}: ${normalizeErrorMessage((error as Error).message)}`)
    }
  }

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
