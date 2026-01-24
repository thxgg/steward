import type { RepoConfig, AddRepoRequest } from '~/types/repo'

const STORAGE_KEY = 'prd-viewer-current-repo'

export function useRepos() {
  // Reactive repos list fetched from API
  const { data: repos, refresh: refreshRepos, status } = useFetch<RepoConfig[]>('/api/repos', {
    default: () => []
  })

  // Current repo ID stored in localStorage
  const currentRepoId = useState<string | null>('currentRepoId', () => {
    if (import.meta.client) {
      return localStorage.getItem(STORAGE_KEY)
    }
    return null
  })

  // Computed current repo object
  const currentRepo = computed(() => {
    if (!currentRepoId.value || !repos.value) return null
    return repos.value.find(r => r.id === currentRepoId.value) || null
  })

  // Select a repo by ID
  function selectRepo(id: string | null) {
    currentRepoId.value = id
    if (import.meta.client) {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }

  // Add a new repo
  async function addRepo(path: string, name?: string): Promise<RepoConfig> {
    const body: AddRepoRequest = { path, name }
    const newRepo = await $fetch<RepoConfig>('/api/repos', {
      method: 'POST',
      body
    })
    await refreshRepos()
    // Auto-select the newly added repo
    selectRepo(newRepo.id)
    return newRepo
  }

  // Remove a repo by ID
  async function removeRepo(id: string): Promise<void> {
    await $fetch(`/api/repos/${id}`, {
      method: 'DELETE'
    })
    // If we deleted the current repo, clear selection
    if (currentRepoId.value === id) {
      selectRepo(null)
    }
    await refreshRepos()
  }

  // Initialize: restore from localStorage on client
  if (import.meta.client) {
    const storedId = localStorage.getItem(STORAGE_KEY)
    if (storedId && !currentRepoId.value) {
      currentRepoId.value = storedId
    }
  }

  return {
    repos,
    currentRepo,
    currentRepoId,
    status,
    selectRepo,
    addRepo,
    removeRepo,
    refreshRepos
  }
}
