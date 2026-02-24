import type { GitRepoInfo, RepoConfig } from '../../../app/types/repo.js'
import {
  addRepo,
  discoverGitRepos,
  getRepoById,
  getRepos,
  removeRepo,
  updateRepoGitRepos,
  validateRepoPath
} from '../../../server/utils/repos.js'
import { migrateLegacyStateForRepo } from '../../../server/utils/prd-state.js'
import { requireCurrentRepo, requireRepo } from './repo-context.js'

export const repos = {
  async list(): Promise<RepoConfig[]> {
    return await getRepos()
  },

  async get(repoId: string): Promise<RepoConfig | null> {
    return await getRepoById(repoId) ?? null
  },

  async current(): Promise<RepoConfig> {
    return await requireCurrentRepo()
  },

  async add(path: string, name?: string): Promise<RepoConfig> {
    const validation = await validateRepoPath(path)
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid repository path')
    }

    const repo = await addRepo(path, name)
    await migrateLegacyStateForRepo(repo)
    return repo
  },

  async remove(repoId: string): Promise<{ removed: true }> {
    await requireRepo(repoId)

    const removed = await removeRepo(repoId)
    if (!removed) {
      throw new Error('Repository not found')
    }

    return { removed: true }
  },

  async refreshGitRepos(repoId: string): Promise<{ discovered: number; gitRepos: GitRepoInfo[] }> {
    const repo = await requireRepo(repoId)
    const gitRepos = await discoverGitRepos(repo.path)

    await updateRepoGitRepos(repo.id, gitRepos.length > 0 ? gitRepos : undefined)

    return {
      discovered: gitRepos.length,
      gitRepos
    }
  }
}
