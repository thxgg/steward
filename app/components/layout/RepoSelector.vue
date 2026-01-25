<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ChevronDown, Plus, FolderOpen, Check, Trash2, Folder } from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '~/components/ui/sheet'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

const router = useRouter()
const route = useRoute()
const { repos, currentRepo, currentRepoId, selectRepo, addRepo, removeRepo } = useRepos()
const { showSuccess, showError } = useToast()

// Dropdown state
const open = ref(false)
const searchQuery = ref('')
const dropdownRef = ref<HTMLElement | null>(null)

// Close dropdown when clicking outside
onClickOutside(dropdownRef, () => {
  if (open.value) {
    open.value = false
    searchQuery.value = ''
  }
})

// Close dropdown when route changes (e.g., command palette navigation)
watch(() => route.fullPath, () => {
  open.value = false
  searchQuery.value = ''
})

async function handleSelectRepo(id: string) {
  selectRepo(id)
  open.value = false
  searchQuery.value = ''

  // Fetch PRDs for new repo and navigate to first one
  try {
    const prds = await $fetch<{ slug: string }[]>(`/api/repos/${id}/prds`)
    const firstPrd = prds?.[0]
    if (firstPrd) {
      router.push(`/${id}/${firstPrd.slug}`)
    } else {
      router.push('/')
    }
  } catch {
    router.push('/')
  }
}

function handleAddClick() {
  open.value = false
  showAddDialog.value = true
}

// Directory browser state
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
  } catch {
    // Silently fail - directory browser will show empty state
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

// Add repo dialog state
const showAddDialog = ref(false)
const newRepoPath = ref('')
const addError = ref<string | null>(null)
const isAdding = ref(false)

// Filtered repos based on search
const filteredRepos = computed(() => {
  if (!searchQuery.value) return repos.value
  const query = searchQuery.value.toLowerCase()
  return repos.value?.filter(
    repo => repo.name.toLowerCase().includes(query) || repo.path.toLowerCase().includes(query)
  ) ?? []
})


async function handleAddRepo() {
  if (!newRepoPath.value.trim()) {
    addError.value = 'Please enter a repository path'
    return
  }

  isAdding.value = true
  addError.value = null

  try {
    const newRepo = await addRepo(newRepoPath.value.trim())
    showAddDialog.value = false
    newRepoPath.value = ''
    showSuccess('Repository added', newRepo?.name || 'Successfully added repository')

    // Navigate to first PRD of newly added repo
    if (newRepo?.id) {
      try {
        const prds = await $fetch<{ slug: string }[]>(`/api/repos/${newRepo.id}/prds`)
        const firstPrd = prds?.[0]
        if (firstPrd) {
          router.push(`/${newRepo.id}/${firstPrd.slug}`)
        }
      } catch {
        // Ignore navigation errors
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      // Extract message from fetch error
      const fetchError = error as { data?: { message?: string } }
      addError.value = fetchError.data?.message || error.message
    } else {
      addError.value = 'Failed to add repository'
    }
  } finally {
    isAdding.value = false
  }
}

async function handleRemoveRepo(event: Event, repoId: string) {
  event.stopPropagation()
  await removeRepo(repoId)
}

function handleDialogClose() {
  showAddDialog.value = false
  newRepoPath.value = ''
  addError.value = null
}

// Expose method to open the add dialog from outside (e.g., via keyboard shortcut)
defineExpose({
  openAddDialog: () => {
    showAddDialog.value = true
  }
})
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <!-- Simple dropdown for repo selection -->
    <button
      type="button"
      class="inline-flex h-8 w-[200px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm font-normal ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      @click="open = !open"
    >
      <span class="flex items-center gap-2 truncate">
        <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
        <span class="truncate">
          {{ currentRepo?.name ?? 'Select repository' }}
        </span>
      </span>
      <ChevronDown class="size-4 shrink-0 opacity-50" />
    </button>

    <!-- Dropdown content -->
    <div
      v-if="open"
      class="absolute top-full right-0 z-[9999] mt-1 w-[280px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <!-- Search input -->
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search repositories..."
        class="mb-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <!-- Repository items -->
      <div class="max-h-[200px] overflow-y-auto">
        <template v-if="filteredRepos?.length">
          <div
            v-for="repo in filteredRepos"
            :key="repo.id"
            class="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            role="option"
            :aria-selected="currentRepoId === repo.id"
            @click="handleSelectRepo(repo.id)"
          >
            <Check
              class="size-4 shrink-0"
              :class="currentRepoId === repo.id ? 'opacity-100' : 'opacity-0'"
            />
            <div class="flex flex-1 flex-col gap-0.5 overflow-hidden text-left">
              <span class="truncate font-medium">{{ repo.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ repo.path }}</span>
            </div>
            <button
              type="button"
              class="ml-auto opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
              title="Remove repository"
              @click="handleRemoveRepo($event, repo.id)"
            >
              <Trash2 class="size-3.5 text-destructive" />
            </button>
          </div>
        </template>
        <div v-else class="px-2 py-1.5 text-sm text-muted-foreground">
          No repositories found.
        </div>

        <!-- Separator -->
        <div v-if="filteredRepos?.length" class="my-1 h-px bg-border" />

        <!-- Add repository option -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          @click="handleAddClick"
        >
          <Plus class="size-4" />
          <span>Add repository...</span>
        </button>
      </div>
    </div>

    <!-- Add Repository Sheet -->
    <Sheet :open="showAddDialog" @update:open="showAddDialog = $event">
      <SheetContent side="right" class="flex h-full flex-col" @escape-key-down="handleDialogClose">
        <SheetHeader class="px-6">
          <SheetTitle>Add Repository</SheetTitle>
          <SheetDescription>
            Enter the absolute path to a repository containing PRD documents.
          </SheetDescription>
        </SheetHeader>

        <form id="add-repo-form" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6" @submit.prevent="handleAddRepo">
          <div class="space-y-2">
            <label for="repo-path" class="text-sm font-medium">
              Repository Path
            </label>
            <div class="flex gap-2">
              <Input
                id="repo-path"
                v-model="newRepoPath"
                placeholder="/path/to/your/project"
                :aria-invalid="!!addError"
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
            <p class="text-xs text-muted-foreground">
              The repository should contain a <code class="rounded bg-muted px-1">docs/prd/</code> directory with markdown files.
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
        </form>

        <SheetFooter class="px-6 pb-6">
          <Button
            type="button"
            variant="outline"
            :disabled="isAdding"
            @click="handleDialogClose"
          >
            Cancel
          </Button>
          <Button type="submit" form="add-repo-form" :disabled="isAdding">
            <span v-if="isAdding">Adding...</span>
            <span v-else>Add Repository</span>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
