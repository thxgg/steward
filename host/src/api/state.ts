import { resolve } from 'node:path'
import type { RepoConfig } from '../../../app/types/repo'
import type { ProgressFile, TasksFile } from '../../../app/types/task'
import {
  getPrdState,
  getPrdStateSummaries,
  migrateLegacyStateForRepo,
  type PrdStateSummary,
  type PrdStateUpdate,
  upsertPrdState
} from '../../../server/utils/prd-state'
import { getRepoById, getRepos } from '../../../server/utils/repos'

export interface StatePayload {
  tasks?: TasksFile | null
  progress?: ProgressFile | null
  notes?: string | null
}

async function requireRepo(repoId: string): Promise<RepoConfig> {
  const repo = await getRepoById(repoId)
  if (!repo) {
    throw new Error('Repository not found')
  }

  return repo
}

async function findRepoByPath(repoPath: string): Promise<RepoConfig> {
  const absolutePath = resolve(repoPath)
  const repos = await getRepos()
  const repo = repos.find((candidate) => resolve(candidate.path) === absolutePath)

  if (!repo) {
    throw new Error(`No registered repository found for path: ${absolutePath}`)
  }

  return repo
}

function mapStateUpdate(payload: StatePayload): PrdStateUpdate {
  return {
    ...(payload.tasks !== undefined && { tasks: payload.tasks }),
    ...(payload.progress !== undefined && { progress: payload.progress }),
    ...(payload.notes !== undefined && { notes: payload.notes })
  }
}

function mapSummaryMap(summaries: Map<string, PrdStateSummary>): Record<string, PrdStateSummary> {
  return Object.fromEntries(summaries.entries())
}

export const state = {
  async get(repoId: string, slug: string) {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)
    return await getPrdState(repo.id, slug)
  },

  async getByPath(repoPath: string, slug: string) {
    const repo = await findRepoByPath(repoPath)
    await migrateLegacyStateForRepo(repo)
    return await getPrdState(repo.id, slug)
  },

  async summaries(repoId: string): Promise<Record<string, PrdStateSummary>> {
    const repo = await requireRepo(repoId)
    await migrateLegacyStateForRepo(repo)
    const summaries = await getPrdStateSummaries(repo.id)
    return mapSummaryMap(summaries)
  },

  async summariesByPath(repoPath: string): Promise<Record<string, PrdStateSummary>> {
    const repo = await findRepoByPath(repoPath)
    await migrateLegacyStateForRepo(repo)
    const summaries = await getPrdStateSummaries(repo.id)
    return mapSummaryMap(summaries)
  },

  async upsert(repoId: string, slug: string, payload: StatePayload): Promise<{ saved: true }> {
    const repo = await requireRepo(repoId)
    await upsertPrdState(repo.id, slug, mapStateUpdate(payload))

    return { saved: true }
  },

  async upsertByPath(repoPath: string, slug: string, payload: StatePayload): Promise<{ saved: true }> {
    const repo = await findRepoByPath(repoPath)
    await upsertPrdState(repo.id, slug, mapStateUpdate(payload))

    return { saved: true }
  }
}
