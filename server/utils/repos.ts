import { promises as fs } from 'node:fs'
import { join, basename, resolve, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RepoConfig, GitRepoInfo } from '~/types/repo'

const DATA_DIR = join(process.cwd(), 'server', 'data')
const REPOS_FILE = join(DATA_DIR, 'repos.json')

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
  } catch {
    // Directory already exists
  }
}

export async function getRepos(): Promise<RepoConfig[]> {
  try {
    const data = await fs.readFile(REPOS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

export async function saveRepos(repos: RepoConfig[]): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(REPOS_FILE, JSON.stringify(repos, null, 2))
}

export async function addRepo(path: string, name?: string): Promise<RepoConfig> {
  const repos = await getRepos()

  // Normalize and resolve the path
  const resolvedPath = resolve(path)

  // Check if path already exists
  if (repos.some(r => r.path === resolvedPath)) {
    throw new Error('Repository already added')
  }

  const repo: RepoConfig = {
    id: randomUUID(),
    name: name || basename(resolvedPath),
    path: resolvedPath,
    addedAt: new Date().toISOString()
  }

  repos.push(repo)
  await saveRepos(repos)

  return repo
}

export async function removeRepo(id: string): Promise<boolean> {
  const repos = await getRepos()
  const index = repos.findIndex(r => r.id === id)

  if (index === -1) {
    return false
  }

  repos.splice(index, 1)
  await saveRepos(repos)

  return true
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

    // Check if it looks like a valid repository (has docs/prd or .claude directory)
    const hasPrdDir = await fs.stat(join(resolvedPath, 'docs', 'prd')).then(() => true).catch(() => false)
    const hasClaudeDir = await fs.stat(join(resolvedPath, '.claude')).then(() => true).catch(() => false)

    if (!hasPrdDir && !hasClaudeDir) {
      return {
        valid: false,
        error: 'Directory does not appear to be a valid PRD repository (missing docs/prd or .claude directory)'
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Directory does not exist' }
  }
}
