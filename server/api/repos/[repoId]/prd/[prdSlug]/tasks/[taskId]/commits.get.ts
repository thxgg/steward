import { getRepos, saveRepos, discoverGitRepos } from '~~/server/utils/repos'
import { getPrdState, migrateLegacyStateForRepo } from '~~/server/utils/prd-state'
import { resolveCommitRepo } from '~~/server/utils/git'
import type { ProgressFile, CommitRef } from '~/types/task'
import type { RepoConfig } from '~/types/repo'

/**
 * Response format for resolved commits
 */
interface ResolvedCommitResponse {
  sha: string
  repo: string
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')
  const taskId = getRouterParam(event, 'taskId')

  if (!repoId || !prdSlug || !taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID, PRD slug, and task ID are required'
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  await migrateLegacyStateForRepo(repo)

  let progress: ProgressFile | null = null
  try {
    const state = await getPrdState(repo.id, prdSlug)
    progress = state?.progress ?? null
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to read progress state: ${(error as Error).message}`
    })
  }

  if (!progress) {
    return []
  }

  // Find task log entry matching taskId
  const taskLog = progress.taskLogs.find(log => log.taskId === taskId)

  if (!taskLog) {
    throw createError({
      statusCode: 404,
      statusMessage: `Task "${taskId}" not found in progress state`
    })
  }

  // No commits recorded
  if (!taskLog.commits || taskLog.commits.length === 0) {
    return []
  }

  // Resolve all commits to normalized format with repo context
  const resolvedCommits: ResolvedCommitResponse[] = []
  const failedEntries: (string | CommitRef)[] = []

  // First pass: try to resolve commits with current repo config
  for (const commitEntry of taskLog.commits) {
    try {
      const resolved = await resolveCommitRepo(repo, commitEntry)
      resolvedCommits.push({
        sha: resolved.sha,
        repo: resolved.repoPath,
      })
    } catch {
      failedEntries.push(commitEntry)
    }
  }

  // If some commits failed and this is a pseudo-monorepo, try re-discovering git repos
  if (failedEntries.length > 0) {
    const newGitRepos = await discoverGitRepos(repo.path)

    // Check if we discovered any new repos
    const existingPaths = new Set((repo.gitRepos || []).map(gr => gr.relativePath))
    const hasNewRepos = newGitRepos.some(gr => !existingPaths.has(gr.relativePath))

    if (hasNewRepos) {
      // Update repo config with newly discovered repos
      const repos = await getRepos()
      const repoIndex = repos.findIndex(r => r.id === repoId)
      if (repoIndex !== -1) {
        const updatedRepo: RepoConfig = {
          ...repos[repoIndex]!,
          gitRepos: newGitRepos.length > 0 ? newGitRepos : undefined,
        }
        repos[repoIndex] = updatedRepo
        await saveRepos(repos)

        // Retry failed commits with updated config
        for (const commitEntry of failedEntries) {
          try {
            const resolved = await resolveCommitRepo(updatedRepo, commitEntry)
            resolvedCommits.push({
              sha: resolved.sha,
              repo: resolved.repoPath,
            })
          } catch {
            // Still failed after re-discovery, add with empty repo
            const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
            resolvedCommits.push({
              sha,
              repo: '',
            })
          }
        }
      } else {
        // Repo not found in list, add failed entries with empty repo
        for (const commitEntry of failedEntries) {
          const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
          resolvedCommits.push({
            sha,
            repo: '',
          })
        }
      }
    } else {
      // No new repos discovered, add failed entries with empty repo
      for (const commitEntry of failedEntries) {
        const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
        resolvedCommits.push({
          sha,
          repo: '',
        })
      }
    }
  }

  return resolvedCommits
})
