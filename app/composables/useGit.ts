import type { GitCommit, FileDiff, DiffHunk } from '~/types/git'
import { isAbortError } from '~/lib/async-request'

export interface FetchCommitsResult {
  commits: GitCommit[]
  failedShas: string[]
}

export interface GitRequestOptions {
  repoPath?: string
  signal?: AbortSignal
  suppressError?: boolean
}

export function useGit() {
  const { showError } = useToast()

  function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const fetchError = error as {
        data?: { message?: string; statusMessage?: string }
        message?: string
      }

      return fetchError.data?.message
        || fetchError.data?.statusMessage
        || fetchError.message
        || 'Unknown error'
    }

    return 'Unknown error'
  }

  // Loading states
  const loadingCommitsCount = ref(0)
  const loadingDiffCount = ref(0)
  const loadingFileDiffCount = ref(0)
  const loadingFileContentCount = ref(0)

  const isLoadingCommits = computed(() => loadingCommitsCount.value > 0)
  const isLoadingDiff = computed(() => loadingDiffCount.value > 0)
  const isLoadingFileDiff = computed(() => loadingFileDiffCount.value > 0)
  const isLoadingFileContent = computed(() => loadingFileContentCount.value > 0)

  function startLoading(counter: { value: number }) {
    counter.value += 1
  }

  function stopLoading(counter: { value: number }) {
    counter.value = Math.max(0, counter.value - 1)
  }

  /**
   * Fetch commit details for an array of SHAs
   * @param repoId - Repository ID
   * @param shas - Array of commit SHAs
   * @param options - Optional request options
   * @returns Object with fetched commits and SHAs that failed to load
   */
  async function fetchCommits(
    repoId: string,
    shas: string[],
    options?: GitRequestOptions
  ): Promise<FetchCommitsResult> {
    if (!repoId || shas.length === 0) {
      return { commits: [], failedShas: [] }
    }

    startLoading(loadingCommitsCount)
    try {
      const query: Record<string, string> = { shas: shas.join(',') }
      if (options?.repoPath) {
        query.repo = options.repoPath
      }

      const commits = await $fetch<GitCommit[]>(
        `/api/repos/${repoId}/git/commits`,
        {
          query,
          signal: options?.signal
        }
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
      if (isAbortError(error)) {
        return { commits: [], failedShas: [] }
      }

      if (!options?.suppressError) {
        showError('Failed to fetch commits', getErrorMessage(error))
      }

      // All requested SHAs failed
      return { commits: [], failedShas: shas }
    } finally {
      stopLoading(loadingCommitsCount)
    }
  }

  /**
   * Fetch file list with stats for a commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param options - Optional request options
   */
  async function fetchDiff(
    repoId: string,
    commitSha: string,
    options?: GitRequestOptions
  ): Promise<FileDiff[]> {
    if (!repoId || !commitSha) {
      return []
    }

    startLoading(loadingDiffCount)
    try {
      const query: Record<string, string> = { commit: commitSha }
      if (options?.repoPath) {
        query.repo = options.repoPath
      }

      const files = await $fetch<FileDiff[]>(
        `/api/repos/${repoId}/git/diff`,
        {
          query,
          signal: options?.signal
        }
      )
      return files
    } catch (error) {
      if (!isAbortError(error) && !options?.suppressError) {
        showError('Failed to fetch diff', getErrorMessage(error))
      }
      throw error
    } finally {
      stopLoading(loadingDiffCount)
    }
  }

  /**
   * Fetch diff hunks for a specific file in a commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param filePath - Path to the file
   * @param options - Optional request options
   */
  async function fetchFileDiff(
    repoId: string,
    commitSha: string,
    filePath: string,
    options?: GitRequestOptions
  ): Promise<DiffHunk[]> {
    if (!repoId || !commitSha || !filePath) {
      return []
    }

    startLoading(loadingFileDiffCount)
    try {
      const query: Record<string, string> = { commit: commitSha, file: filePath }
      if (options?.repoPath) {
        query.repo = options.repoPath
      }

      const hunks = await $fetch<DiffHunk[]>(
        `/api/repos/${repoId}/git/file-diff`,
        {
          query,
          signal: options?.signal
        }
      )
      return hunks
    } catch (error) {
      if (!isAbortError(error) && !options?.suppressError) {
        showError('Failed to fetch file diff', getErrorMessage(error))
      }
      throw error
    } finally {
      stopLoading(loadingFileDiffCount)
    }
  }

  /**
   * Fetch file content at a specific commit
   * @param repoId - Repository ID
   * @param commitSha - Commit SHA
   * @param filePath - Path to the file
   * @param options - Optional request options
   */
  async function fetchFileContent(
    repoId: string,
    commitSha: string,
    filePath: string,
    options?: GitRequestOptions
  ): Promise<string | null> {
    if (!repoId || !commitSha || !filePath) {
      return null
    }

    startLoading(loadingFileContentCount)
    try {
      const query: Record<string, string> = { commit: commitSha, file: filePath }
      if (options?.repoPath) {
        query.repo = options.repoPath
      }

      const result = await $fetch<{ content: string }>(
        `/api/repos/${repoId}/git/file-content`,
        {
          query,
          signal: options?.signal
        }
      )
      return result.content
    } catch (error) {
      if (!isAbortError(error) && !options?.suppressError) {
        showError('Failed to fetch file content', getErrorMessage(error))
      }
      throw error
    } finally {
      stopLoading(loadingFileContentCount)
    }
  }

  return {
    // Functions
    fetchCommits,
    fetchDiff,
    fetchFileDiff,
    fetchFileContent,
    // Loading states
    isLoadingCommits,
    isLoadingDiff,
    isLoadingFileDiff,
    isLoadingFileContent,
  }
}
