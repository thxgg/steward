import { promises as fs } from 'node:fs'
import { join, basename, resolve, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RepoConfig, GitRepoInfo } from '~/types/repo'
import { dbAll, dbGet, dbRun } from './db'

const LEGACY_REPOS_FILE = join(process.cwd(), 'server', 'data', 'repos.json')

type RepoRow = {
  id: string
  name: string
  path: string
  added_at: string
  git_repos_json: string | null
}

let legacyImportPromise: Promise<void> | null = null

function serializeGitRepos(gitRepos?: GitRepoInfo[]): string | null {
  return gitRepos && gitRepos.length > 0 ? JSON.stringify(gitRepos) : null
}

function parseGitRepos(gitReposJson: string | null): GitRepoInfo[] | undefined {
  if (!gitReposJson) {
    return undefined
  }

  try {
    const parsed = JSON.parse(gitReposJson)
    if (!Array.isArray(parsed)) {
      return undefined
    }

    const validRepos = parsed.filter((item): item is GitRepoInfo => {
      return !!item
        && typeof item === 'object'
        && typeof (item as { relativePath?: unknown }).relativePath === 'string'
        && typeof (item as { absolutePath?: unknown }).absolutePath === 'string'
        && typeof (item as { name?: unknown }).name === 'string'
    })

    return validRepos.length > 0 ? validRepos : undefined
  } catch {
    return undefined
  }
}

function rowToRepo(row: RepoRow): RepoConfig {
  const gitRepos = parseGitRepos(row.git_repos_json)
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    addedAt: row.added_at,
    ...(gitRepos && { gitRepos })
  }
}

function isLegacyRepoConfig(value: unknown): value is RepoConfig {
  if (!value || typeof value !== 'object') {
    return false
  }

  const repo = value as Partial<RepoConfig>
  return typeof repo.id === 'string'
    && typeof repo.name === 'string'
    && typeof repo.path === 'string'
    && typeof repo.addedAt === 'string'
}

async function importLegacyReposIfNeeded(): Promise<void> {
  if (legacyImportPromise) {
    return legacyImportPromise
  }

  legacyImportPromise = (async () => {
    const row = await dbGet<{ count: number }>('SELECT COUNT(*) as count FROM repos')
    if ((row?.count ?? 0) > 0) {
      return
    }

    let legacyRepos: unknown
    try {
      const content = await fs.readFile(LEGACY_REPOS_FILE, 'utf-8')
      legacyRepos = JSON.parse(content)
    } catch {
      return
    }

    if (!Array.isArray(legacyRepos) || legacyRepos.length === 0) {
      return
    }

    for (const candidate of legacyRepos) {
      if (!isLegacyRepoConfig(candidate)) {
        continue
      }

      const repo = candidate
      await dbRun(
        `
          INSERT INTO repos (id, name, path, added_at, git_repos_json)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            path = excluded.path,
            added_at = excluded.added_at,
            git_repos_json = excluded.git_repos_json
        `,
        [repo.id, repo.name, repo.path, repo.addedAt, serializeGitRepos(repo.gitRepos)]
      )
    }

    try {
      await fs.unlink(LEGACY_REPOS_FILE)
    } catch {
      // Legacy file may not be removable; DB remains source of truth.
    }
  })()

  return legacyImportPromise
}

export async function getRepos(): Promise<RepoConfig[]> {
  await importLegacyReposIfNeeded()
  const rows = await dbAll<RepoRow>('SELECT id, name, path, added_at, git_repos_json FROM repos ORDER BY added_at ASC')
  return rows.map(rowToRepo)
}

export async function saveRepos(repos: RepoConfig[]): Promise<void> {
  await importLegacyReposIfNeeded()

  for (const repo of repos) {
    await dbRun(
      `
        INSERT INTO repos (id, name, path, added_at, git_repos_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          added_at = excluded.added_at,
          git_repos_json = excluded.git_repos_json
      `,
      [repo.id, repo.name, repo.path, repo.addedAt, serializeGitRepos(repo.gitRepos)]
    )
  }

  if (repos.length === 0) {
    await dbRun('DELETE FROM repos')
    return
  }

  const repoIds = repos.map(repo => repo.id)
  const placeholders = repoIds.map(() => '?').join(', ')
  await dbRun(`DELETE FROM repos WHERE id NOT IN (${placeholders})`, repoIds)
}

export async function addRepo(path: string, name?: string): Promise<RepoConfig> {
  await importLegacyReposIfNeeded()

  const resolvedPath = resolve(path)

  const existing = await dbGet<{ id: string }>('SELECT id FROM repos WHERE path = ?', [resolvedPath])
  if (existing) {
    throw new Error('Repository already added')
  }

  const gitRepos = await discoverGitRepos(resolvedPath)

  const repo: RepoConfig = {
    id: randomUUID(),
    name: name || basename(resolvedPath),
    path: resolvedPath,
    addedAt: new Date().toISOString(),
    ...(gitRepos.length > 0 && { gitRepos })
  }

  await dbRun(
    'INSERT INTO repos (id, name, path, added_at, git_repos_json) VALUES (?, ?, ?, ?, ?)',
    [repo.id, repo.name, repo.path, repo.addedAt, serializeGitRepos(repo.gitRepos)]
  )

  return repo
}

/**
 * Get a repository by its ID
 */
export async function getRepoById(id: string): Promise<RepoConfig | undefined> {
  await importLegacyReposIfNeeded()
  const row = await dbGet<RepoRow>(
    'SELECT id, name, path, added_at, git_repos_json FROM repos WHERE id = ?',
    [id]
  )
  return row ? rowToRepo(row) : undefined
}

export async function removeRepo(id: string): Promise<boolean> {
  await importLegacyReposIfNeeded()
  const result = await dbRun('DELETE FROM repos WHERE id = ?', [id])
  return result.changes > 0
}

/**
 * Directories to skip when scanning for git repos
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'target', // Rust
  'Pods', // iOS
])

/**
 * Check if a directory contains a .git folder (is a git repository)
 */
async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitPath = join(dirPath, '.git')
    const stats = await fs.stat(gitPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Discover git repositories within a directory up to a specified depth.
 * Returns empty array if basePath itself is a git repo (standard case).
 *
 * @param basePath - The root directory to scan
 * @param maxDepth - Maximum depth to scan (default: 2)
 * @returns Array of discovered git repository info
 */
export async function discoverGitRepos(
  basePath: string,
  maxDepth: number = 2
): Promise<GitRepoInfo[]> {
  const resolvedBase = resolve(basePath)

  // If basePath itself is a git repo, return empty (standard repo case)
  if (await isGitRepo(resolvedBase)) {
    return []
  }

  const discovered: GitRepoInfo[] = []

  async function scanDirectory(dirPath: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (IGNORED_DIRS.has(entry.name)) continue

        const fullPath = join(dirPath, entry.name)

        // Check if this directory is a git repo
        if (await isGitRepo(fullPath)) {
          const relativePath = relative(resolvedBase, fullPath)
          discovered.push({
            relativePath,
            absolutePath: fullPath,
            name: entry.name,
          })
          // Don't scan inside git repos
          continue
        }

        // Continue scanning subdirectories
        await scanDirectory(fullPath, currentDepth + 1)
      }
    } catch {
      // Permission denied or other errors - skip this directory
    }
  }

  await scanDirectory(resolvedBase, 1)

  return discovered
}

export async function validateRepoPath(path: string): Promise<{ valid: boolean; error?: string }> {
  // Normalize the path
  const resolvedPath = resolve(path)

  // Ensure path is absolute (starts with / on Unix or drive letter on Windows)
  if (!resolvedPath.startsWith('/') && !/^[A-Za-z]:/.test(resolvedPath)) {
    return { valid: false, error: 'Path must be absolute' }
  }

  try {
    const stats = await fs.stat(resolvedPath)
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' }
    }

    // Check if it looks like a valid repository (has docs/prd directory)
    const hasPrdDir = await fs.stat(join(resolvedPath, 'docs', 'prd')).then(() => true).catch(() => false)

    if (!hasPrdDir) {
      return {
        valid: false,
        error: 'Directory does not appear to be a valid PRD repository (missing docs/prd directory)'
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Directory does not exist' }
  }
}
