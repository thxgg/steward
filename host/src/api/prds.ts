import type { PrdDocument, PrdListItem } from '../../../app/types/prd.js'
import type { ProgressFile, TasksFile } from '../../../app/types/task.js'
import {
  listPrdDocuments,
  readPrdDocument,
  readPrdProgress,
  readPrdTasks,
  resolveTaskCommits,
  type ResolvedTaskCommit
} from '../../../server/utils/prd-service.js'
import { requireRepo } from './repo-context.js'

export type { ResolvedTaskCommit }

export const prds = {
  async list(repoId: string): Promise<PrdListItem[]> {
    const repo = await requireRepo(repoId)
    return await listPrdDocuments(repo)
  },

  async getDocument(repoId: string, prdSlug: string): Promise<PrdDocument> {
    const repo = await requireRepo(repoId)
    return await readPrdDocument(repo, prdSlug)
  },

  async getTasks(repoId: string, prdSlug: string): Promise<TasksFile | null> {
    const repo = await requireRepo(repoId)
    return await readPrdTasks(repo, prdSlug)
  },

  async getProgress(repoId: string, prdSlug: string): Promise<ProgressFile | null> {
    const repo = await requireRepo(repoId)
    return await readPrdProgress(repo, prdSlug)
  },

  async getTaskCommits(repoId: string, prdSlug: string, taskId: string): Promise<ResolvedTaskCommit[]> {
    const repo = await requireRepo(repoId)
    return await resolveTaskCommits(repo, prdSlug, taskId)
  }
}
