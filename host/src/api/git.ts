import type { DiffHunk, FileDiff, GitCommit } from '../../../app/types/git.js'
import type { RepoConfig } from '../../../app/types/repo.js'
import {
  getCommitDiff,
  getCommitInfo,
  getFileContent,
  getFileDiff,
  isGitRepo,
  validatePathInRepo
} from '../../../server/utils/git.js'
import { getRepoById } from '../../../server/utils/repos.js'

async function requireRepo(repoId: string): Promise<RepoConfig> {
  const repo = await getRepoById(repoId)
  if (!repo) {
    throw new Error('Repository not found')
  }

  return repo
}

function resolveGitRepoPath(repo: RepoConfig, repoPath?: string): string {
  if (!repoPath) {
    return repo.path
  }

  if (!repo.gitRepos || repo.gitRepos.length === 0) {
    throw new Error('repo parameter provided but no git repos discovered in this repository')
  }

  const matchedRepo = repo.gitRepos.find((gitRepo) => gitRepo.relativePath === repoPath)
  if (!matchedRepo) {
    const available = repo.gitRepos.map((gitRepo) => gitRepo.relativePath).join(', ')
    throw new Error(`repo "${repoPath}" is not a discovered git repo. Available: ${available}`)
  }

  return matchedRepo.absolutePath
}

export const git = {
  async getCommits(repoId: string, shas: string[], repoPath?: string): Promise<GitCommit[]> {
    if (!Array.isArray(shas) || shas.length === 0) {
      throw new Error('At least one SHA is required')
    }

    const repo = await requireRepo(repoId)
    const gitRepoPath = resolveGitRepoPath(repo, repoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    const commits: GitCommit[] = []
    const errors: string[] = []

    for (const sha of shas) {
      try {
        const commit = await getCommitInfo(gitRepoPath, sha)
        commits.push({
          ...commit,
          repoPath: repoPath || ''
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${sha}: ${message}`)
      }
    }

    if (commits.length === 0 && errors.length > 0) {
      throw new Error(`No valid commits found: ${errors.join('; ')}`)
    }

    return commits
  },

  async getDiff(repoId: string, commit: string, repoPath?: string): Promise<FileDiff[]> {
    if (!commit) {
      throw new Error('commit is required')
    }

    const repo = await requireRepo(repoId)
    const gitRepoPath = resolveGitRepoPath(repo, repoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    return await getCommitDiff(gitRepoPath, commit)
  },

  async getFileDiff(repoId: string, commit: string, file: string, repoPath?: string): Promise<DiffHunk[]> {
    if (!commit) {
      throw new Error('commit is required')
    }

    if (!file) {
      throw new Error('file is required')
    }

    const repo = await requireRepo(repoId)
    const gitRepoPath = resolveGitRepoPath(repo, repoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    if (!validatePathInRepo(gitRepoPath, file)) {
      throw new Error('Invalid file path: path traversal not allowed')
    }

    return await getFileDiff(gitRepoPath, commit, file)
  },

  async getFileContent(repoId: string, commit: string, file: string, repoPath?: string): Promise<string> {
    if (!commit) {
      throw new Error('commit is required')
    }

    if (!file) {
      throw new Error('file is required')
    }

    const repo = await requireRepo(repoId)
    const gitRepoPath = resolveGitRepoPath(repo, repoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    return await getFileContent(gitRepoPath, commit, file)
  }
}
