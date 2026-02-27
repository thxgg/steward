import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { RepoConfig } from '../../app/types/repo.js'

export function normalizePathSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

export function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export function normalizeRepoRelativePath(repoRoot: string, repoPath: string): string | null {
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

function normalizeComparablePath(value: string): string {
  return normalizePathSlashes(value).replace(/\/+$/, '')
}

function getKnownRepoPaths(repo: Pick<RepoConfig, 'gitRepos'>): Set<string> {
  const knownPaths = new Set<string>()

  for (const gitRepo of repo.gitRepos || []) {
    knownPaths.add(normalizePathSlashes(gitRepo.relativePath))
  }

  return knownPaths
}

/**
 * Normalize a commit repo reference or API repo parameter to canonical relative form.
 *
 * - `''` means repository root git repo.
 * - Non-empty values are normalized relative paths under repo root.
 * - Returns `null` when the path attempts traversal outside repo root.
 */
export function normalizeCommitRepoRefPath(
  repo: Pick<RepoConfig, 'name' | 'path' | 'gitRepos'>,
  repoPath: string
): string | null {
  const repoRoot = resolve(repo.path)
  const trimmed = repoPath.trim()

  if (!trimmed || trimmed === '.' || trimmed === './') {
    return ''
  }

  const normalizedRelativePath = normalizeRepoRelativePath(repoRoot, trimmed)
  if (normalizedRelativePath === null) {
    return null
  }

  if (normalizedRelativePath === '') {
    return ''
  }

  const knownRepoPaths = getKnownRepoPaths(repo)
  if (knownRepoPaths.has(normalizedRelativePath)) {
    return normalizedRelativePath
  }

  const comparable = normalizeComparablePath(trimmed)
  const repoName = normalizeComparablePath(repo.name)
  const repoBaseName = normalizeComparablePath(basename(repoRoot))

  if (comparable === repoName || comparable === repoBaseName) {
    return ''
  }

  return normalizedRelativePath
}
