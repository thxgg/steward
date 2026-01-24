<script setup lang="ts">
import { FolderOpen, FileText, ArrowRight, Folder } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

const router = useRouter()
const { repos, currentRepo, currentRepoId, addRepo, status: reposStatus } = useRepos()
const { prds, prdsStatus } = usePrd()

// Onboarding state
const newRepoPath = ref('')
const addError = ref<string | null>(null)
const isAdding = ref(false)

// Directory browser state (reused from RepoSelector pattern)
const showBrowser = ref(false)
const browserPath = ref('')
const browserDirs = ref<{ name: string; path: string }[]>([])
const browserLoading = ref(false)

async function browseDirectory(path?: string) {
  browserLoading.value = true
  try {
    const data = await $fetch('/api/browse', {
      query: { path: path || browserPath.value || undefined }
    })
    browserPath.value = data.current
    browserDirs.value = data.directories
  } catch (err) {
    console.error('Browse error:', err)
  } finally {
    browserLoading.value = false
  }
}

function openBrowser() {
  showBrowser.value = true
  browseDirectory(newRepoPath.value || undefined)
}

function selectDirectory(path: string) {
  newRepoPath.value = path
  showBrowser.value = false
  addError.value = null
}

function navigateUp() {
  const parent = browserPath.value.split('/').slice(0, -1).join('/') || '/'
  browseDirectory(parent)
}

async function handleAddRepo() {
  if (!newRepoPath.value.trim()) {
    addError.value = 'Please enter a repository path'
    return
  }

  isAdding.value = true
  addError.value = null

  try {
    await addRepo(newRepoPath.value.trim())
    newRepoPath.value = ''
  } catch (error) {
    if (error instanceof Error) {
      const fetchError = error as { data?: { message?: string } }
      addError.value = fetchError.data?.message || error.message
    } else {
      addError.value = 'Failed to add repository'
    }
  } finally {
    isAdding.value = false
  }
}

// Determine what state we're in
const showOnboarding = computed(() => {
  return reposStatus.value !== 'pending' && (!repos.value || repos.value.length === 0)
})

const showSelectPrompt = computed(() => {
  return repos.value && repos.value.length > 0 && !currentRepoId.value
})

const showWelcome = computed(() => {
  return currentRepoId.value && (!prds.value || prds.value.length === 0)
})

const showPrdList = computed(() => {
  return currentRepoId.value && prds.value && prds.value.length > 0
})

// Auto-navigate to first PRD when repo is selected and has documents
watch(
  [currentRepoId, prds, prdsStatus],
  ([repoId, prdList, status]) => {
    if (repoId && status === 'success' && prdList && prdList.length > 0) {
      router.push(`/${repoId}/${prdList[0].slug}`)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-full items-center justify-center p-6 md:p-8">
    <!-- Onboarding: No repos configured -->
    <div v-if="showOnboarding" class="mx-auto max-w-md text-center">
      <div class="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
        <FolderOpen class="size-8 text-primary" />
      </div>
      <h2 class="text-2xl font-semibold tracking-tight">
        Welcome to PRD Viewer
      </h2>
      <p class="mt-2 text-muted-foreground">
        Add a repository to get started. The repository should contain PRD documents in a <code class="rounded bg-muted px-1.5 py-0.5 text-sm">docs/prd/</code> directory.
      </p>

      <form class="mt-6 space-y-4 text-left" @submit.prevent="handleAddRepo">
        <div class="space-y-2">
          <label for="repo-path" class="text-sm font-medium">
            Repository Path
          </label>
          <div class="flex gap-2">
            <Input
              id="repo-path"
              v-model="newRepoPath"
              placeholder="/path/to/your/project"
              :disabled="isAdding"
              class="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              :disabled="isAdding"
              @click="openBrowser"
            >
              <Folder class="size-4" />
            </Button>
          </div>
          <p v-if="addError" class="text-sm text-destructive">
            {{ addError }}
          </p>
        </div>

        <!-- Directory Browser -->
        <div v-if="showBrowser" class="space-y-2 rounded-md border p-3">
          <div class="flex items-center gap-2 text-sm">
            <button
              type="button"
              class="hover:text-foreground text-muted-foreground"
              :disabled="browserPath === '/'"
              @click="navigateUp"
            >
              ..
            </button>
            <span class="flex-1 truncate font-mono text-xs text-muted-foreground">
              {{ browserPath }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 text-xs"
              @click="selectDirectory(browserPath)"
            >
              Select
            </Button>
          </div>
          <div class="max-h-[200px] overflow-y-auto">
            <div v-if="browserLoading" class="py-2 text-center text-sm text-muted-foreground">
              Loading...
            </div>
            <div v-else-if="!browserDirs.length" class="py-2 text-center text-sm text-muted-foreground">
              No subdirectories
            </div>
            <button
              v-for="dir in browserDirs"
              v-else
              :key="dir.path"
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
              @click="browseDirectory(dir.path)"
            >
              <Folder class="size-4 text-muted-foreground" />
              <span class="truncate">{{ dir.name }}</span>
            </button>
          </div>
        </div>

        <Button type="submit" class="w-full" :disabled="isAdding">
          <span v-if="isAdding">Adding...</span>
          <span v-else>Add Repository</span>
        </Button>
      </form>
    </div>

    <!-- Select prompt: Repos exist but none selected -->
    <div v-else-if="showSelectPrompt" class="mx-auto max-w-md text-center">
      <div class="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
        <FolderOpen class="size-8 text-primary" />
      </div>
      <h2 class="text-2xl font-semibold tracking-tight">
        Select a Repository
      </h2>
      <p class="mt-2 text-muted-foreground">
        Choose a repository from the dropdown in the header to view its PRD documents.
      </p>
      <div class="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <ArrowRight class="size-4" />
        <span>Use the repository selector above</span>
      </div>
    </div>

    <!-- Welcome: Repo selected but no PRDs -->
    <div v-else-if="showWelcome" class="mx-auto max-w-md text-center">
      <div class="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-muted">
        <FileText class="size-8 text-muted-foreground" />
      </div>
      <h2 class="text-2xl font-semibold tracking-tight">
        No PRDs Found
      </h2>
      <p class="mt-2 text-muted-foreground">
        This repository doesn't have any PRD documents yet. Add markdown files to <code class="rounded bg-muted px-1.5 py-0.5 text-sm">docs/prd/</code> to get started.
      </p>
    </div>

    <!-- PRD list: Repo selected with PRDs - show welcome with PRD count -->
    <div v-else-if="showPrdList" class="mx-auto max-w-md text-center">
      <div class="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
        <FileText class="size-8 text-primary" />
      </div>
      <h2 class="text-2xl font-semibold tracking-tight">
        {{ currentRepo?.name }}
      </h2>
      <p class="mt-2 text-muted-foreground">
        {{ prds?.length }} PRD{{ prds?.length === 1 ? '' : 's' }} available. Select one from the sidebar to view details.
      </p>
      <div class="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <ArrowRight class="size-4 rotate-180" />
        <span>Choose a PRD from the sidebar</span>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else class="mx-auto max-w-md text-center">
      <div class="mx-auto mb-6 flex size-16 items-center justify-center">
        <div class="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
      <p class="text-muted-foreground">Loading...</p>
    </div>
  </div>
</template>
