import type { GitCommit, FileDiff, DiffHunk } from '~/types/git'

export function useGit() {
  const { showError } = useToast()

  // Loading states
  const isLoadingCommits = ref(false)
  const isLoadingDiff = ref(false)
  const isLoadingFileDiff = ref(false)

  /**
   * Fetch commit details for an array of SHAs
   */
  async function fetchCommits(repoId: string, shas: string[]): Promise<GitCommit[]> {
    if (!repoId || shas.length === 0) {
      return []
    }

    isLoadingCommits.value = true
    try {
      const commits = await $fetch<GitCommit[]>(
        `/api/repos/${repoId}/git/commits`,
        {
          query: { shas: shas.join(',') },
        }
      )
      return commits
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      showError('Failed to fetch commits', message)
      return []
    } finally {
      isLoadingCommits.value = false
    }
  }

  /**
   * Fetch file list with stats for a commit
   */
  async function fetchDiff(repoId: string, commitSha: string): Promise<FileDiff[]> {
    if (!repoId || !commitSha) {
      return []
    }

    isLoadingDiff.value = true
    try {
      const files = await $fetch<FileDiff[]>(
        `/api/repos/${repoId}/git/diff`,
        {
          query: { commit: commitSha },
        }
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
   */
  async function fetchFileDiff(
    repoId: string,
    commitSha: string,
    filePath: string
  ): Promise<DiffHunk[]> {
    if (!repoId || !commitSha || !filePath) {
      return []
    }

    isLoadingFileDiff.value = true
    try {
      const hunks = await $fetch<DiffHunk[]>(
        `/api/repos/${repoId}/git/file-diff`,
        {
          query: { commit: commitSha, file: filePath },
        }
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

  return {
    // Functions
    fetchCommits,
    fetchDiff,
    fetchFileDiff,
    // Loading states
    isLoadingCommits: readonly(isLoadingCommits),
    isLoadingDiff: readonly(isLoadingDiff),
    isLoadingFileDiff: readonly(isLoadingFileDiff),
  }
}
