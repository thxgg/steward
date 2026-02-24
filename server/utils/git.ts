import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { GitCommit, FileDiff, DiffHunk, DiffLine, FileStatus, DiffLineType } from '../../app/types/git.js'
import type { RepoConfig } from '../../app/types/repo.js'
import type { CommitRef } from '../../app/types/task.js'

export interface GitWorkingTreeStatus {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

export interface GitCommitResult {
  sha: string
  shortSha: string
  message: string
  files: string[]
}

/**
 * Execute a git command and return stdout
 */
async function execGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: repoPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `git exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`))
    })
  })
}

/**
 * Check if a path is a valid git repository
 */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execGit(path, ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

/**
 * Validate that a file path is within the repository
 */
export function validatePathInRepo(repoPath: string, filePath: string): boolean {
  const resolvedRepo = resolve(repoPath)
  const resolvedFile = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(repoPath, filePath)

  // Check that the file is within the repo
  const relativePath = relative(resolvedRepo, resolvedFile)
  return !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function dedupeAndSort(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function normalizeStatusPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed.includes(' -> ')) {
    return trimmed
  }

  const segments = trimmed.split(' -> ')
  return segments[segments.length - 1]?.trim() || trimmed
}

function normalizePathForGit(repoPath: string, path: string): string {
  if (!validatePathInRepo(repoPath, path)) {
    throw new Error(`Invalid file path: ${path}`)
  }

  const absolutePath = isAbsolute(path)
    ? resolve(path)
    : resolve(repoPath, path)

  const relativePath = relative(resolve(repoPath), absolutePath)
  if (!relativePath || relativePath === '.') {
    throw new Error('Path must point to a file or subdirectory inside the repository')
  }

  return relativePath
}

/**
 * Get working tree changes split by staged/unstaged/untracked buckets.
 */
export async function getWorkingTreeStatus(repoPath: string): Promise<GitWorkingTreeStatus> {
  const output = await execGit(repoPath, ['status', '--porcelain'])
  const staged = new Set<string>()
  const unstaged = new Set<string>()
  const untracked = new Set<string>()

  const lines = output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length >= 3)

  for (const line of lines) {
    const indexStatus = line.charAt(0)
    const worktreeStatus = line.charAt(1)
    const path = normalizeStatusPath(line.slice(3))

    if (!path) {
      continue
    }

    if (indexStatus === '?' && worktreeStatus === '?') {
      untracked.add(path)
      continue
    }

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.add(path)
    }

    if (worktreeStatus !== ' ') {
      unstaged.add(path)
    }
  }

  return {
    staged: dedupeAndSort(staged),
    unstaged: dedupeAndSort(unstaged),
    untracked: dedupeAndSort(untracked)
  }
}

/**
 * Stage explicit paths in a repository.
 */
export async function stagePaths(repoPath: string, paths: string[]): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) {
    return []
  }

  const normalizedPaths = dedupeAndSort(
    paths
      .map(path => path.trim())
      .filter(path => path.length > 0)
      .map(path => normalizePathForGit(repoPath, path))
  )

  if (normalizedPaths.length === 0) {
    return []
  }

  await execGit(repoPath, ['add', '--', ...normalizedPaths])
  return normalizedPaths
}

/**
 * Commit currently staged changes. Returns null when nothing is staged.
 */
export async function commitStagedChanges(repoPath: string, message: string): Promise<GitCommitResult | null> {
  const trimmedMessage = message.trim()
  if (!trimmedMessage) {
    throw new Error('Commit message is required')
  }

  const stagedOutput = await execGit(repoPath, ['diff', '--cached', '--name-only'])
  const stagedFiles = stagedOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (stagedFiles.length === 0) {
    return null
  }

  await execGit(repoPath, ['commit', '-m', trimmedMessage])

  const sha = (await execGit(repoPath, ['rev-parse', 'HEAD'])).trim()
  const shortSha = (await execGit(repoPath, ['rev-parse', '--short', 'HEAD'])).trim()

  return {
    sha,
    shortSha,
    message: trimmedMessage,
    files: stagedFiles
  }
}

/**
 * Get commit information by SHA
 */
export async function getCommitInfo(repoPath: string, sha: string): Promise<GitCommit> {
  // Validate SHA format (hex string, 4-40 chars)
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  // Get commit details
  const format = '%H%n%h%n%s%n%an%n%aI'
  const output = await execGit(repoPath, ['show', sha, '--format=' + format, '--no-patch'])
  const lines = output.trim().split('\n')

  if (lines.length < 5) {
    throw new Error(`Failed to parse commit info for ${sha}`)
  }

  // Get stats
  const statsOutput = await execGit(repoPath, ['show', sha, '--format=', '--numstat'])
  const statsLines = statsOutput.trim().split('\n').filter(l => l.trim())

  let additions = 0
  let deletions = 0
  let filesChanged = 0

  for (const line of statsLines) {
    const parts = line.split('\t')
    const added = parts[0]
    const deleted = parts[1]
    if (added && deleted && added !== '-' && deleted !== '-') {
      additions += parseInt(added, 10) || 0
      deletions += parseInt(deleted, 10) || 0
    }
    filesChanged++
  }

  return {
    sha: lines[0]!,
    shortSha: lines[1]!,
    message: lines[2]!,
    author: lines[3]!,
    date: lines[4]!,
    filesChanged,
    additions,
    deletions,
  }
}

/**
 * Get list of changed files in a commit with stats
 */
export async function getCommitDiff(repoPath: string, sha: string): Promise<FileDiff[]> {
  // Validate SHA format
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  // Get file status and stats
  const output = await execGit(repoPath, [
    'show', sha,
    '--format=',
    '--name-status',
    '--numstat',
  ])

  // Parse the output - first part is numstat, then name-status
  const lines = output.trim().split('\n').filter(l => l.trim())

  // We need to get both numstat and name-status info
  const numstatOutput = await execGit(repoPath, ['show', sha, '--format=', '--numstat'])
  const nameStatusOutput = await execGit(repoPath, ['show', sha, '--format=', '--name-status'])

  const numstatLines = numstatOutput.trim().split('\n').filter(l => l.trim())
  const nameStatusLines = nameStatusOutput.trim().split('\n').filter(l => l.trim())

  const files: FileDiff[] = []
  const statsMap = new Map<string, { additions: number; deletions: number; binary: boolean }>()

  // Parse numstat (additions, deletions, path)
  // Binary files show as "-\t-\tfilepath"
  for (const line of numstatLines) {
    const parts = line.split('\t')
    if (parts.length >= 3) {
      const added = parts[0]!
      const deleted = parts[1]!
      const pathParts = parts.slice(2)
      const path = pathParts.join('\t') // Handle paths with tabs (rare but possible)
      const isBinary = added === '-' && deleted === '-'
      statsMap.set(path, {
        additions: isBinary ? 0 : parseInt(added, 10) || 0,
        deletions: isBinary ? 0 : parseInt(deleted, 10) || 0,
        binary: isBinary,
      })
    }
  }

  // Parse name-status (status, path, [oldPath for renames])
  for (const line of nameStatusLines) {
    const parts = line.split('\t')
    if (parts.length < 2 || !parts[0] || !parts[1]) continue

    const statusChar = parts[0].charAt(0)
    let status: FileStatus
    let path: string
    let oldPath: string | undefined

    switch (statusChar) {
      case 'A':
        status = 'added'
        path = parts[1]
        break
      case 'D':
        status = 'deleted'
        path = parts[1]
        break
      case 'M':
        status = 'modified'
        path = parts[1]
        break
      case 'R':
        status = 'renamed'
        oldPath = parts[1]
        path = parts[2] || parts[1]
        break
      case 'C':
        status = 'added' // Treat copy as added
        path = parts[2] || parts[1]
        break
      default:
        status = 'modified'
        path = parts[1]
    }

    // Get stats for this file
    const stats = statsMap.get(path) ||
                  (oldPath ? statsMap.get(`${oldPath} => ${path}`) : undefined) ||
                  statsMap.get(`${oldPath}\t${path}`) ||
                  { additions: 0, deletions: 0, binary: false }

    files.push({
      path,
      status,
      oldPath,
      additions: stats.additions,
      deletions: stats.deletions,
      binary: stats.binary,
    })
  }

  return files
}

/**
 * Get diff hunks for a specific file in a commit
 */
export async function getFileDiff(
  repoPath: string,
  sha: string,
  filePath: string
): Promise<DiffHunk[]> {
  // Validate SHA format
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  // Validate path is within repo
  if (!validatePathInRepo(repoPath, filePath)) {
    throw new Error('File path is outside repository')
  }

  // Get diff for specific file
  const output = await execGit(repoPath, [
    'show', sha,
    '--format=',
    '--unified=3',
    '--', filePath,
  ])

  return parseDiffHunks(output)
}

/**
 * Parse git diff output into hunks
 */
function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const lines = diffOutput.split('\n')

  let currentHunk: DiffHunk | null = null
  let oldLineNum = 0
  let newLineNum = 0

  for (const line of lines) {
    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk)
      }

      const oldStart = parseInt(hunkMatch[1]!, 10)
      const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1
      const newStart = parseInt(hunkMatch[3]!, 10)
      const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1

      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      }

      oldLineNum = oldStart
      newLineNum = newStart
      continue
    }

    // Skip diff headers
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('\\')) {
      continue
    }

    // Parse diff lines
    if (currentHunk) {
      if (line.startsWith('+')) {
        const diffLine: DiffLine = {
          type: 'add',
          content: line.substring(1),
          newNumber: newLineNum++,
        }
        currentHunk.lines.push(diffLine)
      } else if (line.startsWith('-')) {
        const diffLine: DiffLine = {
          type: 'remove',
          content: line.substring(1),
          oldNumber: oldLineNum++,
        }
        currentHunk.lines.push(diffLine)
      } else if (line.startsWith(' ')) {
        const diffLine: DiffLine = {
          type: 'context',
          content: line.substring(1),
          oldNumber: oldLineNum++,
          newNumber: newLineNum++,
        }
        currentHunk.lines.push(diffLine)
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk)
  }

  return hunks
}

export function parseDiffHunksForTest(diffOutput: string): DiffHunk[] {
  return parseDiffHunks(diffOutput)
}

/**
 * Check if a file is binary by attempting to get its diff
 */
export async function isBinaryFile(repoPath: string, sha: string, filePath: string): Promise<boolean> {
  try {
    const output = await execGit(repoPath, [
      'show', sha,
      '--format=',
      '--', filePath,
    ])
    return output.includes('Binary files')
  } catch {
    return false
  }
}

/**
 * Get file content at a specific commit
 */
export async function getFileContent(
  repoPath: string,
  sha: string,
  filePath: string
): Promise<string> {
  // Validate SHA format
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  // Validate path is within repo
  if (!validatePathInRepo(repoPath, filePath)) {
    throw new Error('File path is outside repository')
  }

  // Get file content at commit
  const output = await execGit(repoPath, ['show', `${sha}:${filePath}`])
  return output
}

/**
 * Check if a commit exists in a repository
 */
async function commitExistsInRepo(repoPath: string, sha: string): Promise<boolean> {
  try {
    await execGit(repoPath, ['cat-file', '-t', sha])
    return true
  } catch {
    return false
  }
}

/**
 * Result of resolving a commit to its repository
 */
export interface ResolvedCommit {
  /** Commit SHA */
  sha: string
  /** Relative path to the git repo (empty string for root repo) */
  repoPath: string
  /** Absolute path to the git repo */
  absolutePath: string
}

/**
 * Find which repository contains a given commit SHA.
 * Checks the root path first (if it's a git repo), then searches discovered repos in parallel.
 *
 * @param repoConfig - The repository configuration with optional gitRepos
 * @param sha - The commit SHA to find
 * @returns Resolved commit data for the matching repo, or throws if not found
 */
export async function findRepoForCommit(
  repoConfig: RepoConfig,
  sha: string
): Promise<ResolvedCommit> {
  // Validate SHA format
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  // Check if root path is a git repo first
  if (await isGitRepo(repoConfig.path)) {
    if (await commitExistsInRepo(repoConfig.path, sha)) {
      return {
        sha,
        repoPath: '',
        absolutePath: repoConfig.path,
      }
    }
  }

  // If no discovered repos, commit not found
  if (!repoConfig.gitRepos || repoConfig.gitRepos.length === 0) {
    throw new Error(`Commit ${sha.substring(0, 7)} not found in repository "${repoConfig.name}"`)
  }

  // Search discovered repos in parallel
  const results = await Promise.all(
    repoConfig.gitRepos.map(async (gitRepo): Promise<ResolvedCommit | null> => {
      if (await commitExistsInRepo(gitRepo.absolutePath, sha)) {
        return {
          sha,
          repoPath: gitRepo.relativePath,
          absolutePath: gitRepo.absolutePath,
        }
      }
      return null
    })
  )

  // Find first match
  const found = results.find((r): r is ResolvedCommit => r !== null)
  if (found) {
    return found
  }

  throw new Error(
    `Commit ${sha.substring(0, 7)} not found in repository "${repoConfig.name}" or any of its ${repoConfig.gitRepos.length} discovered git repos`
  )
}

/**
 * Resolve a commit entry (string or CommitRef) to its repository information.
 * For CommitRef objects, returns immediately (O(1)).
 * For string SHAs, searches repositories to find the commit.
 *
 * @param repoConfig - The repository configuration
 * @param commitEntry - Either a commit SHA string or a CommitRef object
 * @returns Resolved commit information with repo path
 */
export async function resolveCommitRepo(
  repoConfig: RepoConfig,
  commitEntry: string | CommitRef
): Promise<ResolvedCommit> {
  // If it's a CommitRef object, we already have the repo info (O(1))
  if (typeof commitEntry === 'object' && commitEntry.sha && commitEntry.repo) {
    return {
      sha: commitEntry.sha,
      repoPath: commitEntry.repo,
      absolutePath: join(repoConfig.path, commitEntry.repo),
    }
  }

  // It's a string SHA, need to search for it
  const sha = typeof commitEntry === 'string' ? commitEntry : commitEntry.sha
  return findRepoForCommit(repoConfig, sha)
}
