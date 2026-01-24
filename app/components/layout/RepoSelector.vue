<script setup lang="ts">
import { ChevronDown, Plus, FolderOpen, Check, Trash2 } from 'lucide-vue-next'
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

const { repos, currentRepo, currentRepoId, selectRepo, addRepo, removeRepo } = useRepos()

// Dropdown state
const open = ref(false)
const searchQuery = ref('')

function handleSelectRepo(id: string) {
  selectRepo(id)
  open.value = false
  searchQuery.value = ''
}

function handleAddClick() {
  open.value = false
  showAddDialog.value = true
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
    await addRepo(newRepoPath.value.trim())
    showAddDialog.value = false
    newRepoPath.value = ''
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
</script>

<template>
  <div class="relative">
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
      class="absolute top-full left-0 z-[9999] mt-1 w-[280px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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
          <button
            v-for="repo in filteredRepos"
            :key="repo.id"
            type="button"
            class="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
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
          </button>
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

    <!-- Click outside to close -->
    <div
      v-if="open"
      class="fixed inset-0 z-[9998]"
      @click="open = false"
    />

    <!-- Add Repository Sheet -->
    <Sheet :open="showAddDialog" @update:open="showAddDialog = $event">
      <SheetContent side="right" @escape-key-down="handleDialogClose">
        <SheetHeader>
          <SheetTitle>Add Repository</SheetTitle>
          <SheetDescription>
            Enter the absolute path to a repository containing PRD documents.
          </SheetDescription>
        </SheetHeader>

        <form class="mt-6 space-y-4" @submit.prevent="handleAddRepo">
          <div class="space-y-2">
            <label for="repo-path" class="text-sm font-medium">
              Repository Path
            </label>
            <Input
              id="repo-path"
              v-model="newRepoPath"
              placeholder="/path/to/your/project"
              :aria-invalid="!!addError"
              :disabled="isAdding"
            />
            <p v-if="addError" class="text-sm text-destructive">
              {{ addError }}
            </p>
            <p class="text-xs text-muted-foreground">
              The repository should contain a <code class="rounded bg-muted px-1">docs/prd/</code> directory with markdown files.
            </p>
          </div>

          <SheetFooter class="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              :disabled="isAdding"
              @click="handleDialogClose"
            >
              Cancel
            </Button>
            <Button type="submit" :disabled="isAdding">
              <span v-if="isAdding">Adding...</span>
              <span v-else>Add Repository</span>
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  </div>
</template>
