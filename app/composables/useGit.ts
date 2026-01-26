import type { GitCommit, FileDiff, DiffHunk } from '~/types/git'

export interface FetchCommitsResult {
  commits: GitCommit[]
  failedShas: string[]
}

export function useGit() {
  const { showError } = useToast()

  // Loading states
  const isLoadingCommits = ref(false)
  const isLoadingDiff = ref(false)
  const isLoadingFileDiff = ref(false)
  const isLoadingFileContent = ref(false)

  /**
   * Fetch commit details for an array of SHAs
   * @param repoId - Repository ID
   * @param shas - Array of commit SHAs
   * @param repoPath - Optional relative path to git repo (for pseudo-monorepos)
   * @returns Object with fetched commits and SHAs that failed to load
   */
  async function fetchCommits(repoId: string, shas: string[], repoPath?: string): Promise<FetchCommitsResult> {
    if (!repoId || shas.length === 0) {
      return { commits: [], failedShas: [] }
    }

    isLoadingCommits.value = true
    try {
      const query: Record<string, string> = { shas: shas.join(',') }
      if (repoPath) {
        query.repo = repoPath
      }

      const commits = await $fetch<GitCommit[]>(
        `/api/repos/${repoId}/git/commits`,
        { query }
      )

      // Determine which SHAs weren't returned (partial failures on server)
      // Use shortSha for comparison since requests may use abbreviated SHAs
      const returnedShortShas = commits.map(c => c.shortSha)
      const failedShas = shas.filter(sha => {
        // Check if any returned shortSha matches the requested SHA (prefix matching)
        return !returnedShortShas.some(shortSha => shortSha.startsWith(sha) || sha.startsWith(shortSha))
      })

      return { commits, failedShas }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      showError('Failed to fetch commits', message)
      // All requested SHAs failed
      return { commits: [], failedShas: shas }
    } finally {
      isLoadingCommits.value = false
    }
  }

  /**
   * Fetch file list with stats for a commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param repoPath - Optional relative path to git repo (for pseudo-monorepos)
   */
  async function fetchDiff(repoId: string, commitSha: string, repoPath?: string): Promise<FileDiff[]> {
    if (!repoId || !commitSha) {
      return []
    }

    isLoadingDiff.value = true
    try {
      const query: Record<string, string> = { commit: commitSha }
      if (repoPath) {
        query.repo = repoPath
      }

      const files = await $fetch<FileDiff[]>(
        `/api/repos/${repoId}/git/diff`,
        { query }
      )
      return files
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      showError('Failed to fetch diff', message)
      return []
    } finally {
      isLoadingDiff.value = false
    }
  }

  /**
   * Fetch diff hunks for a specific file in a commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param filePath - Path to the file
   * @param repoPath - Optional relative path to git repo (for pseudo-monorepos)
   */
  async function fetchFileDiff(
    repoId: string,
    commitSha: string,
    filePath: string,
    repoPath?: string
  ): Promise<DiffHunk[]> {
    if (!repoId || !commitSha || !filePath) {
      return []
    }

    isLoadingFileDiff.value = true
    try {
      const query: Record<string, string> = { commit: commitSha, file: filePath }
      if (repoPath) {
        query.repo = repoPath
      }

      const hunks = await $fetch<DiffHunk[]>(
        `/api/repos/${repoId}/git/file-diff`,
        { query }
      )
      return hunks
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      showError('Failed to fetch file diff', message)
      return []
    } finally {
      isLoadingFileDiff.value = false
    }
  }

  /**
   * Fetch file content at a specific commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param filePath - Path to the file
   * @param repoPath - Optional relative path to git repo (for pseudo-monorepos)
   */
  async function fetchFileContent(
    repoId: string,
    commitSha: string,
    filePath: string,
    repoPath?: string
  ): Promise<string | null> {
    if (!repoId || !commitSha || !filePath) {
      return null
    }

    isLoadingFileContent.value = true
    try {
      const query: Record<string, string> = { commit: commitSha, file: filePath }
      if (repoPath) {
        query.repo = repoPath
      }

      const result = await $fetch<{ content: string }>(
        `/api/repos/${repoId}/git/file-content`,
        { query }
      )
      return result.content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      showError('Failed to fetch file content', message)
      return null
    } finally {
      isLoadingFileContent.value = false
    }
  }

  return {
    // Functions
    fetchCommits,
    fetchDiff,
    fetchFileDiff,
    fetchFileContent,
    // Loading states
    isLoadingCommits: readonly(isLoadingCommits),
    isLoadingDiff: readonly(isLoadingDiff),
    isLoadingFileDiff: readonly(isLoadingFileDiff),
    isLoadingFileContent: readonly(isLoadingFileContent),
  }
}
