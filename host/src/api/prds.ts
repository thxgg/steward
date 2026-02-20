import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { PrdDocument, PrdListItem, PrdMetadata } from '../../../app/types/prd'
import type { CommitRef, ProgressFile, TasksFile } from '../../../app/types/task'
import type { RepoConfig } from '../../../app/types/repo'
import { resolveCommitRepo } from '../../../server/utils/git'
import { discoverGitRepos, getRepoById, getRepos, saveRepos } from '../../../server/utils/repos'
import { getPrdState, getPrdStateSummaries, migrateLegacyStateForRepo } from '../../../server/utils/prd-state'

export interface ResolvedTaskCommit {
  sha: string
  repo: string
}

function parseMetadata(content: string): PrdMetadata {
  const metadata: PrdMetadata = {}

  const authorMatch = content.match(/\*{0,2}Author\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (authorMatch && authorMatch[1]) {
    metadata.author = authorMatch[1].trim()
  }

  const dateMatch = content.match(/\*{0,2}Date\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (dateMatch && dateMatch[1]) {
    metadata.date = dateMatch[1].trim()
  }

  const statusMatch = content.match(/\*{0,2}Status\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (statusMatch && statusMatch[1]) {
    metadata.status = statusMatch[1].trim()
  }

  const shortcutLinkMatch = content.match(/\[([Ss][Cc]-\d+)\]\(([^)]+)\)/)
  if (shortcutLinkMatch && shortcutLinkMatch[1] && shortcutLinkMatch[2]) {
    metadata.shortcutStory = shortcutLinkMatch[1]
    metadata.shortcutUrl = shortcutLinkMatch[2]
  } else {
    const shortcutIdMatch = content.match(/\*{0,2}Shortcut(?:\s+Story)?\*{0,2}:\*{0,2}\s*([Ss][Cc]-\d+)/i)
    if (shortcutIdMatch && shortcutIdMatch[1]) {
      metadata.shortcutStory = shortcutIdMatch[1]
    }
  }

  return metadata
}

async function requireRepo(repoId: string): Promise<RepoConfig> {
  const repo = await getRepoById(repoId)
  if (!repo) {
    throw new Error('Repository not found')
  }

  return repo
}

async function readPrdFile(repo: RepoConfig, prdSlug: string): Promise<string> {
  const prdPath = join(repo.path, 'docs', 'prd', `${prdSlug}.md`)

  try {
    return await fs.readFile(prdPath, 'utf-8')
  } catch {
    throw new Error('PRD not found')
  }
}

export const prds = {
  async list(repoId: string): Promise<PrdListItem[]> {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)

    const prdDir = join(repo.path, 'docs', 'prd')
    let prdFiles: string[] = []

    try {
      const files = await fs.readdir(prdDir)
      prdFiles = files.filter((file) => file.endsWith('.md'))
    } catch {
      return []
    }

    const stateSummaries = await getPrdStateSummaries(repo.id)

    const items: PrdListItem[] = await Promise.all(prdFiles.map(async (filename) => {
      const slug = basename(filename, '.md')
      const filePath = join(prdDir, filename)

      let name = slug
      let modifiedAt = 0

      try {
        const [content, stat] = await Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath)
        ])

        modifiedAt = stat.mtime.getTime()
        const h1Match = content.match(/^#\s+(.+)$/m)
        if (h1Match && h1Match[1]) {
          name = h1Match[1].trim()
        }
      } catch {
        // Keep default values when a file cannot be read.
      }

      const stateSummary = stateSummaries.get(slug)

      return {
        slug,
        name,
        source: `docs/prd/${filename}`,
        hasState: !!stateSummary?.hasState,
        modifiedAt,
        ...(stateSummary?.taskCount !== undefined && { taskCount: stateSummary.taskCount }),
        ...(stateSummary?.completedCount !== undefined && { completedCount: stateSummary.completedCount })
      }
    }))

    items.sort((a, b) => b.modifiedAt - a.modifiedAt)
    return items
  },

  async getDocument(repoId: string, prdSlug: string): Promise<PrdDocument> {
    const repo = await requireRepo(repoId)
    const content = await readPrdFile(repo, prdSlug)

    let name = prdSlug
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match && h1Match[1]) {
      name = h1Match[1].trim()
    }

    return {
      slug: prdSlug,
      name,
      content,
      metadata: parseMetadata(content)
    }
  },

  async getTasks(repoId: string, prdSlug: string): Promise<TasksFile | null> {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)

    const state = await getPrdState(repo.id, prdSlug)
    return state?.tasks ?? null
  },

  async getProgress(repoId: string, prdSlug: string): Promise<ProgressFile | null> {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)

    const state = await getPrdState(repo.id, prdSlug)
    return state?.progress ?? null
  },

  async getTaskCommits(repoId: string, prdSlug: string, taskId: string): Promise<ResolvedTaskCommit[]> {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)

    const state = await getPrdState(repo.id, prdSlug)
    const progress = state?.progress ?? null

    if (!progress) {
      return []
    }

    const taskLog = progress.taskLogs.find((log) => log.taskId === taskId)
    if (!taskLog) {
      throw new Error(`Task "${taskId}" not found in progress state`)
    }

    if (!taskLog.commits || taskLog.commits.length === 0) {
      return []
    }

    const resolvedCommits: ResolvedTaskCommit[] = []
    const failedEntries: (string | CommitRef)[] = []

    for (const commitEntry of taskLog.commits) {
      try {
        const resolved = await resolveCommitRepo(repo, commitEntry)
        resolvedCommits.push({
          sha: resolved.sha,
          repo: resolved.repoPath
        })
      } catch {
        failedEntries.push(commitEntry)
      }
    }

    if (failedEntries.length > 0) {
      const newGitRepos = await discoverGitRepos(repo.path)
      const existingPaths = new Set((repo.gitRepos || []).map((gitRepo) => gitRepo.relativePath))
      const hasNewRepos = newGitRepos.some((gitRepo) => !existingPaths.has(gitRepo.relativePath))
      let resolvedWithUpdatedRepo = false

      if (hasNewRepos) {
        const allRepos = await getRepos()
        const repoIndex = allRepos.findIndex((candidate) => candidate.id === repoId)

        if (repoIndex !== -1) {
          const updatedRepo: RepoConfig = {
            ...allRepos[repoIndex]!,
            gitRepos: newGitRepos.length > 0 ? newGitRepos : undefined
          }

          allRepos[repoIndex] = updatedRepo
          await saveRepos(allRepos)
          resolvedWithUpdatedRepo = true

          for (const commitEntry of failedEntries) {
            try {
              const resolved = await resolveCommitRepo(updatedRepo, commitEntry)
              resolvedCommits.push({
                sha: resolved.sha,
                repo: resolved.repoPath
              })
            } catch {
              const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
              resolvedCommits.push({ sha, repo: '' })
            }
          }
        }
      }

      if (!resolvedWithUpdatedRepo) {
        for (const commitEntry of failedEntries) {
          const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
          resolvedCommits.push({
            sha,
            repo: ''
          })
        }
      }
    }

    return resolvedCommits
  }
}
