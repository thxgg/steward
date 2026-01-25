import { promises as fs } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RepoConfig } from '~/types/repo'

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
