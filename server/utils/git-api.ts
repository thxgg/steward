import { isAbsolute, relative, resolve } from 'node:path'
import type { GitRepoInfo, RepoConfig } from '../../app/types/repo.js'
import { findRepoForCommit, isGitRepo } from './git.js'
import { discoverGitRepos } from './repos.js'

const GIT_DISCOVERY_DEPTH = 4
const SHA_PATTERN = /^[0-9a-f]{4,40}$/i

export const MAX_COMMIT_QUERY_SHAS = 100
export const MAX_GIT_REPO_PATH_LENGTH = 512
export const MAX_GIT_FILE_PATH_LENGTH = 2048

function normalizePathSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function normalizeRepoRelativePath(repoRoot: string, repoPath: string): string | null {
  const absolutePath = isAbsolute(repoPath)
    ? resolve(repoPath)
    : resolve(repoRoot, repoPath)

  if (!isWithinPath(repoRoot, absolutePath)) {
    return null
  }

  const relativePath = relative(resolve(repoRoot), absolutePath)
  if (!relativePath || relativePath === '.') {
    return ''
  }

  return normalizePathSlashes(relativePath)
}

function normalizeGitRepoInfo(repoRoot: string, gitRepo: GitRepoInfo): GitRepoInfo | null {
  const normalizedRelativePath = normalizeRepoRelativePath(repoRoot, gitRepo.relativePath)
  if (!normalizedRelativePath) {
    return null
  }

  return {
    relativePath: normalizedRelativePath,
    absolutePath: resolve(repoRoot, normalizedRelativePath),
    name: gitRepo.name
  }
}

function mergeGitRepos(repoRoot: string, existing?: GitRepoInfo[], discovered?: GitRepoInfo[]): GitRepoInfo[] | undefined {
  const merged = new Map<string, GitRepoInfo>()

  for (const gitRepo of existing || []) {
    const normalizedRepo = normalizeGitRepoInfo(repoRoot, gitRepo)
    if (!normalizedRepo) {
      continue
    }

    merged.set(normalizedRepo.relativePath, normalizedRepo)
  }

  for (const gitRepo of discovered || []) {
    const normalizedRepo = normalizeGitRepoInfo(repoRoot, gitRepo)
    if (!normalizedRepo) {
      continue
    }

    merged.set(normalizedRepo.relativePath, normalizedRepo)
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined
}

export function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

export function getRepoRelativePath(repoRoot: string, gitRepoPath: string): string {
  const relativePath = relative(resolve(repoRoot), resolve(gitRepoPath))
  return !relativePath || relativePath === '.' ? '' : normalizePathSlashes(relativePath)
}

export async function buildRepoLookup(repo: RepoConfig): Promise<RepoConfig> {
  const repoRoot = resolve(repo.path)
  const discoveredRepos = await discoverGitRepos(repoRoot, GIT_DISCOVERY_DEPTH)
  const gitRepos = mergeGitRepos(repoRoot, repo.gitRepos, discoveredRepos)

  if (!gitRepos) {
    return {
      ...repo,
      gitRepos: undefined,
    }
  }

  return {
    ...repo,
    gitRepos,
  }
}

export async function resolveRequestedGitRepoPath(
  repo: RepoConfig,
  repoPath?: string
): Promise<{ gitRepoPath: string; normalizedRepoPath: string }> {
  if (!repoPath) {
    return {
      gitRepoPath: repo.path,
      normalizedRepoPath: '',
    }
  }

  const repoRoot = resolve(repo.path)
  const normalizedRequestedPath = normalizeRepoRelativePath(repoRoot, repoPath)

  if (normalizedRequestedPath === null) {
    throw new Error('Invalid repo path: path traversal not allowed')
  }

  const requestedAbsolutePath = resolve(repoRoot, normalizedRequestedPath)

  const knownMatch = (repo.gitRepos || []).find((gitRepo) => {
    return normalizePathSlashes(gitRepo.relativePath) === normalizedRequestedPath
  })

  if (knownMatch) {
    const knownAbsolutePath = resolve(repoRoot, normalizePathSlashes(knownMatch.relativePath))
    if (!isWithinPath(repoRoot, knownAbsolutePath)) {
      throw new Error('Invalid repo path: stored git repo path is outside repository root')
    }

    return {
      gitRepoPath: knownAbsolutePath,
      normalizedRepoPath: normalizePathSlashes(knownMatch.relativePath),
    }
  }

  if (await isGitRepo(requestedAbsolutePath)) {
    return {
      gitRepoPath: requestedAbsolutePath,
      normalizedRepoPath: normalizedRequestedPath,
    }
  }

  const lookupRepo = await buildRepoLookup(repo)
  const discoveredMatch = (lookupRepo.gitRepos || []).find((gitRepo) => {
    return normalizePathSlashes(gitRepo.relativePath) === normalizedRequestedPath
  })

  if (discoveredMatch) {
    return {
      gitRepoPath: discoveredMatch.absolutePath,
      normalizedRepoPath: normalizePathSlashes(discoveredMatch.relativePath),
    }
  }

  const availableRepos = (lookupRepo.gitRepos || [])
    .map((gitRepo) => gitRepo.relativePath)
    .join(', ')

  throw new Error(
    `repo "${repoPath}" is not a discovered git repo. Available: ${availableRepos || '(none)'}`
  )
}

export async function resolveCommitGitRepoPath(
  repo: RepoConfig,
  sha: string
): Promise<{ gitRepoPath: string; normalizedRepoPath: string }> {
  const lookupRepo = await buildRepoLookup(repo)
  const resolvedCommit = await findRepoForCommit(lookupRepo, sha)

  return {
    gitRepoPath: resolvedCommit.absolutePath,
    normalizedRepoPath: resolvedCommit.repoPath,
  }
}

function normalizeQueryString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function isValidGitSha(sha: string): boolean {
  return SHA_PATTERN.test(sha)
}

export function parseCommitShaParam(value: unknown, label: string): string {
  const sha = normalizeQueryString(value)
  if (!sha) {
    throw new Error(`${label} is required`)
  }

  if (!isValidGitSha(sha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  return sha
}

export function parseCommitShaListParam(value: unknown): string[] {
  const raw = normalizeQueryString(value)
  if (!raw) {
    throw new Error('shas query parameter is required')
  }

  const shas = raw
    .split(',')
    .map((sha) => sha.trim())
    .filter(Boolean)

  if (shas.length === 0) {
    throw new Error('At least one SHA is required')
  }

  if (shas.length > MAX_COMMIT_QUERY_SHAS) {
    throw new Error(`Too many SHAs requested (max ${MAX_COMMIT_QUERY_SHAS})`)
  }

  for (const sha of shas) {
    if (!isValidGitSha(sha)) {
      throw new Error(`Invalid commit SHA: ${sha}`)
    }
  }

  return shas
}

export function parseOptionalGitRepoPathParam(value: unknown): string | undefined {
  const repoPath = normalizeQueryString(value)
  if (!repoPath) {
    return undefined
  }

  if (repoPath.length > MAX_GIT_REPO_PATH_LENGTH) {
    throw new Error(`repo query parameter exceeds ${MAX_GIT_REPO_PATH_LENGTH} characters`)
  }

  if (repoPath.includes('\u0000')) {
    throw new Error('repo query parameter contains invalid characters')
  }

  return repoPath
}

export function parseGitFilePathParam(value: unknown): string {
  const filePath = normalizeQueryString(value)
  if (!filePath) {
    throw new Error('File path is required')
  }

  if (filePath.length > MAX_GIT_FILE_PATH_LENGTH) {
    throw new Error(`file query parameter exceeds ${MAX_GIT_FILE_PATH_LENGTH} characters`)
  }

  if (filePath.includes('\u0000')) {
    throw new Error('file query parameter contains invalid characters')
  }

  return filePath
}
