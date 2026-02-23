import type { DiffHunk, FileDiff, GitCommit } from '../../../app/types/git.js'
import type { RepoConfig } from '../../../app/types/repo.js'
import {
  commitStagedChanges,
  getCommitDiff,
  getCommitInfo,
  getFileContent,
  getFileDiff,
  getWorkingTreeStatus,
  isGitRepo,
  stagePaths,
  validatePathInRepo
} from '../../../server/utils/git.js'
import { requireRepo } from './repo-context.js'

export interface GitStatus {
  staged: string[]
  unstaged: string[]
  untracked: string[]
  hasChanges: boolean
  hasStagedChanges: boolean
}

export interface CommitIfChangedOptions {
  repoPath?: string
  paths?: string[]
}

export interface CommitIfChangedResult {
  committed: boolean
  repoPath: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  reason?: 'no_changes' | 'no_staged_changes'
  sha?: string
  shortSha?: string
  message?: string
  committedFiles?: string[]
}

function toGitStatus(status: {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}): GitStatus {
  const hasStagedChanges = status.staged.length > 0
  const hasChanges = hasStagedChanges || status.unstaged.length > 0 || status.untracked.length > 0

  return {
    ...status,
    hasChanges,
    hasStagedChanges
  }
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
  async getStatus(repoId: string, repoPath?: string): Promise<GitStatus> {
    const repo = await requireRepo(repoId)
    const gitRepoPath = resolveGitRepoPath(repo, repoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    const status = await getWorkingTreeStatus(gitRepoPath)
    return toGitStatus(status)
  },

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
  },

  async commitIfChanged(
    repoId: string,
    message: string,
    options?: CommitIfChangedOptions
  ): Promise<CommitIfChangedResult> {
    if (!message || !message.trim()) {
      throw new Error('message is required')
    }

    const repo = await requireRepo(repoId)
    const relativeRepoPath = options?.repoPath || ''
    const gitRepoPath = resolveGitRepoPath(repo, relativeRepoPath)

    if (!await isGitRepo(gitRepoPath)) {
      throw new Error('Resolved path is not a git repository')
    }

    const paths = Array.isArray(options?.paths)
      ? options.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : []

    if (paths.length > 0) {
      await stagePaths(gitRepoPath, paths)
    }

    const statusBefore = await getWorkingTreeStatus(gitRepoPath)
    if (statusBefore.staged.length === 0) {
      const noChanges = statusBefore.unstaged.length === 0 && statusBefore.untracked.length === 0
      return {
        committed: false,
        repoPath: relativeRepoPath,
        staged: statusBefore.staged,
        unstaged: statusBefore.unstaged,
        untracked: statusBefore.untracked,
        reason: noChanges ? 'no_changes' : 'no_staged_changes'
      }
    }

    const commit = await commitStagedChanges(gitRepoPath, message)
    if (!commit) {
      return {
        committed: false,
        repoPath: relativeRepoPath,
        staged: statusBefore.staged,
        unstaged: statusBefore.unstaged,
        untracked: statusBefore.untracked,
        reason: 'no_staged_changes'
      }
    }

    const statusAfter = await getWorkingTreeStatus(gitRepoPath)

    return {
      committed: true,
      repoPath: relativeRepoPath,
      staged: statusAfter.staged,
      unstaged: statusAfter.unstaged,
      untracked: statusAfter.untracked,
      sha: commit.sha,
      shortSha: commit.shortSha,
      message: commit.message,
      committedFiles: commit.files
    }
  }
}
