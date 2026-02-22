import { isAbsolute, relative, resolve } from 'node:path'
import type { GitRepoInfo, RepoConfig } from '../../app/types/repo.js'
import { findRepoForCommit, isGitRepo } from './git.js'
import { discoverGitRepos } from './repos.js'

const GIT_DISCOVERY_DEPTH = 4

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

function mergeGitRepos(existing?: GitRepoInfo[], discovered?: GitRepoInfo[]): GitRepoInfo[] | undefined {
  const merged = new Map<string, GitRepoInfo>()

  for (const gitRepo of existing || []) {
    merged.set(normalizePathSlashes(gitRepo.relativePath), gitRepo)
  }

  for (const gitRepo of discovered || []) {
    merged.set(normalizePathSlashes(gitRepo.relativePath), gitRepo)
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
  const discoveredRepos = await discoverGitRepos(repo.path, GIT_DISCOVERY_DEPTH)
  const gitRepos = mergeGitRepos(repo.gitRepos, discoveredRepos)

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
    return {
      gitRepoPath: knownMatch.absolutePath,
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
