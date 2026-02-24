import type { ProgressFile, TasksFile } from '../../../app/types/task.js'
import {
  getPrdState,
  getPrdStateSummaries,
  migrateLegacyStateForRepo,
  type PrdStateSummary,
  type PrdStateUpdate,
  upsertPrdState
} from '../../../server/utils/prd-state.js'
import { parseProgressFile, parseTasksFile } from '../../../server/utils/state-schema.js'
import { requireCurrentRepo, requireRepo, requireRepoByPath } from './repo-context.js'

export interface StatePayload {
  tasks?: TasksFile | null
  progress?: ProgressFile | null
  notes?: string | null
}

function mapStateUpdate(payload: StatePayload): PrdStateUpdate {
  return {
    ...(payload.tasks !== undefined && {
      tasks: payload.tasks === null ? null : parseTasksFile(payload.tasks)
    }),
    ...(payload.progress !== undefined && {
      progress: payload.progress === null ? null : parseProgressFile(payload.progress)
    }),
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
    const repo = await requireRepoByPath(repoPath)
    await migrateLegacyStateForRepo(repo)
    return await getPrdState(repo.id, slug)
  },

  async getCurrent(slug: string) {
    const repo = await requireCurrentRepo()
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
    const repo = await requireRepoByPath(repoPath)
    await migrateLegacyStateForRepo(repo)
    const summaries = await getPrdStateSummaries(repo.id)
    return mapSummaryMap(summaries)
  },

  async summariesCurrent(): Promise<Record<string, PrdStateSummary>> {
    const repo = await requireCurrentRepo()
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
    const repo = await requireRepoByPath(repoPath)
    await upsertPrdState(repo.id, slug, mapStateUpdate(payload))

    return { saved: true }
  },

  async upsertCurrent(slug: string, payload: StatePayload): Promise<{ saved: true }> {
    const repo = await requireCurrentRepo()
    await upsertPrdState(repo.id, slug, mapStateUpdate(payload))

    return { saved: true }
  }
}
