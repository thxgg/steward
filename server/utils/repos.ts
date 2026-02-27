import { existsSync, promises as fs } from 'node:fs'
import { join, basename, dirname, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { RepoConfig, GitRepoInfo } from '../../app/types/repo.js'
import { dbAll, dbGet, dbRun } from './db.js'
import { ensureRepoSyncMetaForRepo, ensureRepoSyncMetaForRepos } from './sync-identity.js'

function findPackageRoot(startDir: string): string {
  let currentDir = startDir

  while (true) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return startDir
    }

    currentDir = parentDir
  }
}

function normalizePathSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function isPathWithin(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(basePath), resolve(candidatePath))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)))
const LEGACY_REPOS_FILE = join(PACKAGE_ROOT, 'server', 'data', 'repos.json')

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

function parseGitRepos(repoPath: string, gitReposJson: string | null): GitRepoInfo[] | undefined {
  if (!gitReposJson) {
    return undefined
  }

  try {
    const parsed = JSON.parse(gitReposJson)
    if (!Array.isArray(parsed)) {
      return undefined
    }

    const repoRoot = resolve(repoPath)
    const validRepos = new Map<string, GitRepoInfo>()

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const relativePath = (item as { relativePath?: string }).relativePath
      const name = (item as { name?: string }).name

      if (!relativePath || !name) {
        continue
      }

      const normalizedRelativePath = normalizePathSlashes(relativePath).replace(/^\.\//, '')
      if (!normalizedRelativePath || normalizedRelativePath === '.') {
        continue
      }

      const absolutePath = resolve(repoRoot, normalizedRelativePath)
      if (!isPathWithin(repoRoot, absolutePath)) {
        continue
      }

      validRepos.set(normalizedRelativePath, {
        relativePath: normalizedRelativePath,
        absolutePath,
        name
      })
    }

    return validRepos.size > 0 ? Array.from(validRepos.values()) : undefined
  } catch {
    return undefined
  }
}

function rowToRepo(row: RepoRow): RepoConfig {
  const gitRepos = parseGitRepos(row.path, row.git_repos_json)
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
  const repos = rows.map(rowToRepo)
  await ensureRepoSyncMetaForRepos(repos)
  return repos
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

  await ensureRepoSyncMetaForRepos(repos)
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

  await ensureRepoSyncMetaForRepo(repo)

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
  if (!row) {
    return undefined
  }

  const repo = rowToRepo(row)
  await ensureRepoSyncMetaForRepo(repo)
  return repo
}

export async function updateRepoGitRepos(id: string, gitRepos?: GitRepoInfo[]): Promise<boolean> {
  await importLegacyReposIfNeeded()
  const result = await dbRun(
    'UPDATE repos SET git_repos_json = ? WHERE id = ?',
    [serializeGitRepos(gitRepos), id]
  )

  return result.changes > 0
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
    return stats.isDirectory() || stats.isFile()
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
  maxDepth: number = 4
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
  const trimmedPath = path.trim()

  if (trimmedPath.length === 0) {
    return { valid: false, error: 'Path is required' }
  }

  if (trimmedPath.length > 4096) {
    return { valid: false, error: 'Path is too long' }
  }

  if (trimmedPath.includes('\u0000')) {
    return { valid: false, error: 'Path contains invalid characters' }
  }

  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(trimmedPath)
  if (!isAbsolute(trimmedPath) && !isWindowsAbsolutePath) {
    return { valid: false, error: 'Path must be absolute' }
  }

  // Normalize the path
  const resolvedPath = resolve(trimmedPath)

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
