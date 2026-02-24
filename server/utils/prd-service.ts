import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { PrdDocument, PrdListItem, PrdMetadata } from '../../app/types/prd.js'
import type { RepoConfig } from '../../app/types/repo.js'
import type { CommitRef, ProgressFile, TasksFile } from '../../app/types/task.js'
import { resolveCommitRepo } from './git.js'
import { getPrdState, getPrdStateSummaries, migrateLegacyStateForRepo } from './prd-state.js'
import { discoverGitRepos, updateRepoGitRepos } from './repos.js'

const PRD_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

export interface ResolvedTaskCommit {
  sha: string
  repo: string
}

function normalizePathSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function normalizeGitRepos(gitRepos: RepoConfig['gitRepos']): RepoConfig['gitRepos'] {
  if (!gitRepos || gitRepos.length === 0) {
    return undefined
  }

  return gitRepos.map((gitRepo) => ({
    ...gitRepo,
    relativePath: normalizePathSlashes(gitRepo.relativePath)
  }))
}

function hasPathTraversal(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(basePath), resolve(candidatePath))
  return relativePath.startsWith('..') || isAbsolute(relativePath)
}

function extractCommitSha(entry: string | CommitRef): string {
  return typeof entry === 'string' ? entry : entry.sha
}

function parseMetadata(content: string): PrdMetadata {
  const metadata: PrdMetadata = {}

  const authorMatch = content.match(/\*{0,2}Author\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (authorMatch?.[1]) {
    metadata.author = authorMatch[1].trim()
  }

  const dateMatch = content.match(/\*{0,2}Date\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (dateMatch?.[1]) {
    metadata.date = dateMatch[1].trim()
  }

  const statusMatch = content.match(/\*{0,2}Status\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (statusMatch?.[1]) {
    metadata.status = statusMatch[1].trim()
  }

  const shortcutLinkMatch = content.match(/\[([Ss][Cc]-\d+)\]\(([^)]+)\)/)
  if (shortcutLinkMatch?.[1] && shortcutLinkMatch[2]) {
    metadata.shortcutStory = shortcutLinkMatch[1]
    metadata.shortcutUrl = shortcutLinkMatch[2]
  } else {
    const shortcutIdMatch = content.match(/\*{0,2}Shortcut(?:\s+Story)?\*{0,2}:\*{0,2}\s*([Ss][Cc]-\d+)/i)
    if (shortcutIdMatch?.[1]) {
      metadata.shortcutStory = shortcutIdMatch[1]
    }
  }

  return metadata
}

export function isValidPrdSlug(prdSlug: string): boolean {
  return PRD_SLUG_PATTERN.test(prdSlug)
}

export function assertValidPrdSlug(prdSlug: string): void {
  if (!isValidPrdSlug(prdSlug)) {
    throw new Error('Invalid PRD slug format')
  }
}

export function resolvePrdMarkdownPath(repoPath: string, prdSlug: string): string {
  assertValidPrdSlug(prdSlug)

  const prdDir = resolve(repoPath, 'docs', 'prd')
  const prdPath = resolve(prdDir, `${prdSlug}.md`)

  if (hasPathTraversal(prdDir, prdPath)) {
    throw new Error('Invalid PRD slug path traversal')
  }

  return prdPath
}

export function extractPrdTitle(content: string, fallbackSlug: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match?.[1]) {
    return h1Match[1].trim()
  }

  return fallbackSlug
}

export async function readPrdDocument(repo: RepoConfig, prdSlug: string): Promise<PrdDocument> {
  const prdPath = resolvePrdMarkdownPath(repo.path, prdSlug)

  let content: string
  try {
    content = await fs.readFile(prdPath, 'utf-8')
  } catch {
    throw new Error('PRD not found')
  }

  return {
    slug: prdSlug,
    name: extractPrdTitle(content, prdSlug),
    content,
    metadata: parseMetadata(content)
  }
}

export async function listPrdDocuments(repo: RepoConfig): Promise<PrdListItem[]> {
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
      name = extractPrdTitle(content, slug)
    } catch {
      // Keep fallback values when file cannot be read.
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
}

export async function readPrdTasks(repo: RepoConfig, prdSlug: string): Promise<TasksFile | null> {
  assertValidPrdSlug(prdSlug)
  await migrateLegacyStateForRepo(repo)

  const state = await getPrdState(repo.id, prdSlug)
  return state?.tasks ?? null
}

export async function readPrdProgress(repo: RepoConfig, prdSlug: string): Promise<ProgressFile | null> {
  assertValidPrdSlug(prdSlug)
  await migrateLegacyStateForRepo(repo)

  const state = await getPrdState(repo.id, prdSlug)
  return state?.progress ?? null
}

function hasDiscoveredRepoChanges(repo: RepoConfig, discoveredRepos: RepoConfig['gitRepos']): boolean {
  const normalizedExisting = normalizeGitRepos(repo.gitRepos) || []
  const normalizedDiscovered = normalizeGitRepos(discoveredRepos) || []

  if (normalizedExisting.length !== normalizedDiscovered.length) {
    return true
  }

  const existingPaths = new Set(normalizedExisting.map((gitRepo) => gitRepo.relativePath))
  for (const gitRepo of normalizedDiscovered) {
    if (!existingPaths.has(gitRepo.relativePath)) {
      return true
    }
  }

  return false
}

async function refreshDiscoveredGitRepos(repo: RepoConfig): Promise<RepoConfig | null> {
  const discoveredRepos = normalizeGitRepos(await discoverGitRepos(repo.path))
  if (!hasDiscoveredRepoChanges(repo, discoveredRepos)) {
    return null
  }

  const updated = await updateRepoGitRepos(repo.id, discoveredRepos)
  if (!updated) {
    return null
  }

  return {
    ...repo,
    gitRepos: discoveredRepos
  }
}

export async function resolveTaskCommits(
  repo: RepoConfig,
  prdSlug: string,
  taskId: string
): Promise<ResolvedTaskCommit[]> {
  assertValidPrdSlug(prdSlug)
  await migrateLegacyStateForRepo(repo)

  const state = await getPrdState(repo.id, prdSlug)
  const progress = state?.progress ?? null

  if (!progress) {
    return []
  }

  const taskLogs = Array.isArray(progress.taskLogs) ? progress.taskLogs : []
  const taskLog = taskLogs.find((log) => log.taskId === taskId)
  if (!taskLog || !taskLog.commits || taskLog.commits.length === 0) {
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

  if (failedEntries.length === 0) {
    return resolvedCommits
  }

  const refreshedRepo = await refreshDiscoveredGitRepos(repo)

  for (const commitEntry of failedEntries) {
    if (!refreshedRepo) {
      resolvedCommits.push({
        sha: extractCommitSha(commitEntry),
        repo: ''
      })
      continue
    }

    try {
      const resolved = await resolveCommitRepo(refreshedRepo, commitEntry)
      resolvedCommits.push({
        sha: resolved.sha,
        repo: resolved.repoPath
      })
    } catch {
      resolvedCommits.push({
        sha: extractCommitSha(commitEntry),
        repo: ''
      })
    }
  }

  return resolvedCommits
}
