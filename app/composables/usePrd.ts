import type { PrdArchiveState, PrdListItem, PrdDocument } from '~/types/prd'
import type { TasksFile, ProgressFile, CommitRef } from '~/types/task'
import type { GraphPrdPayload, GraphRepoPayload } from '~/types/graph'

export function usePrd() {
  const { currentRepoId } = useRepos()
  const { showError } = useToast()
  const showArchived = useState<boolean>('prd-show-archived', () => false)

  // PRD list for current repo - refetches when currentRepoId changes
  const prdsUrl = computed(() => {
    if (!currentRepoId.value) {
      return ''
    }

    const includeArchivedQuery = showArchived.value ? '?includeArchived=1' : ''
    return `/api/repos/${currentRepoId.value}/prds${includeArchivedQuery}`
  })

  const { data: prds, refresh: refreshPrds, status: prdsStatus, error: prdsError } = useFetch<PrdListItem[]>(
    prdsUrl,
    {
      default: () => [],
      immediate: false
    }
  )

  // Show error toast when PRD list fetch fails
  watch(prdsError, (err) => {
    if (err) {
      showError('Failed to load PRD list', 'The repository may be inaccessible.')
    }
  })

  // Watch for repo changes and fetch PRDs
  watch(currentRepoId, async (newId) => {
    if (newId) {
      await refreshPrds()
    }
  }, { immediate: true })

  watch(showArchived, async () => {
    if (!currentRepoId.value) {
      return
    }

    await refreshPrds()
  })

  // Fetch a PRD document by slug
  async function fetchDocument(slug: string): Promise<PrdDocument | null> {
    if (!currentRepoId.value) return null
    return await $fetch<PrdDocument>(`/api/repos/${currentRepoId.value}/prd/${slug}`)
  }

  // Fetch tasks.json for a PRD
  async function fetchTasks(slug: string): Promise<TasksFile | null> {
    if (!currentRepoId.value) return null
    return await $fetch<TasksFile | null>(`/api/repos/${currentRepoId.value}/prd/${slug}/tasks`)
  }

  // Fetch progress.json for a PRD
  async function fetchProgress(slug: string): Promise<ProgressFile | null> {
    if (!currentRepoId.value) return null
    return await $fetch<ProgressFile | null>(`/api/repos/${currentRepoId.value}/prd/${slug}/progress`)
  }

  // Fetch resolved commits for a task (returns { sha, repo }[] format)
  async function fetchTaskCommits(slug: string, taskId: string): Promise<CommitRef[]> {
    if (!currentRepoId.value) return []
    return await $fetch<CommitRef[]>(
      `/api/repos/${currentRepoId.value}/prd/${slug}/tasks/${taskId}/commits`
    )
  }

  // Fetch graph payload for a single PRD
  async function fetchPrdGraph(slug: string): Promise<GraphPrdPayload | null> {
    if (!currentRepoId.value) return null
    return await $fetch<GraphPrdPayload>(`/api/repos/${currentRepoId.value}/prd/${slug}/graph`)
  }

  // Fetch graph payload across all PRDs in a repo
  async function fetchRepoGraph(): Promise<GraphRepoPayload | null> {
    if (!currentRepoId.value) return null
    return await $fetch<GraphRepoPayload>(`/api/repos/${currentRepoId.value}/graph`, {
      query: showArchived.value ? { includeArchived: '1' } : undefined
    })
  }

  function setShowArchived(value: boolean) {
    showArchived.value = value
  }

  function toggleShowArchived() {
    showArchived.value = !showArchived.value
  }

  async function setPrdArchived(slug: string, archived: boolean): Promise<PrdArchiveState> {
    if (!currentRepoId.value) {
      throw new Error('No repository selected')
    }

    const result = await $fetch<PrdArchiveState>(`/api/repos/${currentRepoId.value}/prd/${slug}/archive`, {
      method: 'POST',
      body: { archived }
    })

    await refreshPrds()
    return result
  }

  return {
    prds,
    prdsStatus,
    showArchived,
    refreshPrds,
    setShowArchived,
    toggleShowArchived,
    setPrdArchived,
    fetchDocument,
    fetchTasks,
    fetchProgress,
    fetchTaskCommits,
    fetchPrdGraph,
    fetchRepoGraph
  }
}
