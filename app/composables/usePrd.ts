import type { PrdListItem, PrdDocument } from '~/types/prd'
import type { TasksFile, ProgressFile } from '~/types/task'

export function usePrd() {
  const { currentRepo, currentRepoId } = useRepos()

  // PRD list for current repo - refetches when currentRepoId changes
  const prdsUrl = computed(() =>
    currentRepoId.value ? `/api/repos/${currentRepoId.value}/prds` : ''
  )

  const { data: prds, refresh: refreshPrds, status: prdsStatus } = useFetch<PrdListItem[]>(
    prdsUrl,
    {
      default: () => [],
      immediate: false
    }
  )

  // Watch for repo changes and fetch PRDs
  watch(currentRepoId, async (newId) => {
    if (newId) {
      await refreshPrds()
    }
  }, { immediate: true })

  // Fetch a PRD document by slug
  async function fetchDocument(slug: string): Promise<PrdDocument | null> {
    if (!currentRepoId.value) return null
    try {
      return await $fetch<PrdDocument>(`/api/repos/${currentRepoId.value}/prd/${slug}`)
    } catch (error) {
      console.error('Failed to fetch PRD document:', error)
      return null
    }
  }

  // Fetch tasks.json for a PRD
  async function fetchTasks(slug: string): Promise<TasksFile | null> {
    if (!currentRepoId.value) return null
    try {
      const result = await $fetch<TasksFile | null>(`/api/repos/${currentRepoId.value}/prd/${slug}/tasks`)
      return result
    } catch (error) {
      console.error('Failed to fetch tasks:', error)
      return null
    }
  }

  // Fetch progress.json for a PRD
  async function fetchProgress(slug: string): Promise<ProgressFile | null> {
    if (!currentRepoId.value) return null
    try {
      const result = await $fetch<ProgressFile | null>(`/api/repos/${currentRepoId.value}/prd/${slug}/progress`)
      return result
    } catch (error) {
      console.error('Failed to fetch progress:', error)
      return null
    }
  }

  return {
    prds,
    prdsStatus,
    refreshPrds,
    fetchDocument,
    fetchTasks,
    fetchProgress
  }
}
