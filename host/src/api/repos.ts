import type { GitRepoInfo, RepoConfig } from '../../../app/types/repo'
import {
  addRepo,
  discoverGitRepos,
  getRepoById,
  getRepos,
  removeRepo,
  saveRepos,
  validateRepoPath
} from '../../../server/utils/repos'
import { migrateLegacyStateForRepo } from '../../../server/utils/prd-state'

export const repos = {
  async list(): Promise<RepoConfig[]> {
    return await getRepos()
  },

  async get(repoId: string): Promise<RepoConfig | null> {
    return await getRepoById(repoId) ?? null
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
    const removed = await removeRepo(repoId)
    if (!removed) {
      throw new Error('Repository not found')
    }

    return { removed: true }
  },

  async refreshGitRepos(repoId: string): Promise<{ discovered: number; gitRepos: GitRepoInfo[] }> {
    const allRepos = await getRepos()
    const repoIndex = allRepos.findIndex((repo) => repo.id === repoId)
    if (repoIndex === -1) {
      throw new Error('Repository not found')
    }

    const repo = allRepos[repoIndex]!
    const gitRepos = await discoverGitRepos(repo.path)

    if (gitRepos.length > 0) {
      repo.gitRepos = gitRepos
    } else {
      delete repo.gitRepos
    }

    allRepos[repoIndex] = repo
    await saveRepos(allRepos)

    return {
      discovered: gitRepos.length,
      gitRepos
    }
  }
}
