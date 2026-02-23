import { resolve } from 'node:path'
import type { RepoConfig } from '../../../app/types/repo.js'
import { getRepoById, getRepos } from '../../../server/utils/repos.js'

type RepoSummary = {
  id: string
  name: string
  path: string
}

type RepoLookupErrorCode =
  | 'NO_REPOS'
  | 'AMBIGUOUS_REPO'
  | 'REPO_NOT_FOUND'
  | 'REPO_PATH_NOT_FOUND'

type RepoLookupErrorDetails = {
  repoId?: string
  repoPath?: string
  knownRepos: RepoSummary[]
}

export class RepoLookupError extends Error {
  constructor(
    message: string,
    public readonly code: RepoLookupErrorCode,
    public readonly details: RepoLookupErrorDetails
  ) {
    super(message)
    this.name = 'RepoLookupError'
  }
}

function summarizeRepos(repos: RepoConfig[]): RepoSummary[] {
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path
  }))
}

function formatKnownRepos(knownRepos: RepoSummary[]): string {
  return knownRepos
    .map((repo) => `${repo.id} (${repo.name}) ${repo.path}`)
    .join('; ')
}

export async function requireRepo(repoId: string): Promise<RepoConfig> {
  const repo = await getRepoById(repoId)
  if (repo) {
    return repo
  }

  const allRepos = await getRepos()
  const knownRepos = summarizeRepos(allRepos)

  if (knownRepos.length === 0) {
    throw new RepoLookupError(
      `Unknown repoId "${repoId}". No repositories are registered. Use repos.add(path) first.`,
      'NO_REPOS',
      { repoId, knownRepos }
    )
  }

  throw new RepoLookupError(
    `Unknown repoId "${repoId}". Known repositories: ${formatKnownRepos(knownRepos)}`,
    'REPO_NOT_FOUND',
    { repoId, knownRepos }
  )
}

export async function requireRepoByPath(repoPath: string): Promise<RepoConfig> {
  const absolutePath = resolve(repoPath)
  const allRepos = await getRepos()
  const repo = allRepos.find((candidate) => resolve(candidate.path) === absolutePath)
  if (repo) {
    return repo
  }

  const knownRepos = summarizeRepos(allRepos)
  if (knownRepos.length === 0) {
    throw new RepoLookupError(
      `No registered repository found for path: ${absolutePath}. No repositories are registered. Use repos.add(path) first.`,
      'NO_REPOS',
      { repoPath: absolutePath, knownRepos }
    )
  }

  throw new RepoLookupError(
    `No registered repository found for path: ${absolutePath}. Known repositories: ${formatKnownRepos(knownRepos)}`,
    'REPO_PATH_NOT_FOUND',
    { repoPath: absolutePath, knownRepos }
  )
}

export async function requireCurrentRepo(): Promise<RepoConfig> {
  const allRepos = await getRepos()
  if (allRepos.length === 1) {
    return allRepos[0]!
  }

  const knownRepos = summarizeRepos(allRepos)

  if (knownRepos.length === 0) {
    throw new RepoLookupError(
      'No repositories are registered. Use repos.add(path) first.',
      'NO_REPOS',
      { knownRepos }
    )
  }

  throw new RepoLookupError(
    `Cannot resolve a current repository because ${knownRepos.length} repositories are registered. Use an explicit repoId or by-path API. Known repositories: ${formatKnownRepos(knownRepos)}`,
    'AMBIGUOUS_REPO',
    { knownRepos }
  )
}
