<script setup lang="ts">
import { ChevronDown, Plus, FolderOpen, Check, Trash2 } from 'lucide-vue-next'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxViewport,
  ComboboxTrigger
} from '~/components/ui/combobox'
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

// Combobox state
const open = ref(false)
const searchQuery = ref('')
const selectedValue = ref<string | undefined>(currentRepoId.value ?? undefined)

// Watch for selection changes
watch(selectedValue, (newValue) => {
  if (newValue === '__add__') {
    showAddDialog.value = true
    // Reset to previous value
    selectedValue.value = currentRepoId.value ?? undefined
  } else if (newValue && newValue !== currentRepoId.value) {
    selectRepo(newValue)
  }
  searchQuery.value = ''
})

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
    <!-- Combobox for repo selection -->
    <Combobox
      v-model="selectedValue"
      v-model:open="open"
      v-model:search-term="searchQuery"
    >
      <ComboboxTrigger as-child>
        <Button
          variant="outline"
          size="sm"
          class="w-[200px] justify-between gap-2 font-normal"
          role="combobox"
          :aria-expanded="open"
        >
          <span class="flex items-center gap-2 truncate">
            <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate">
              {{ currentRepo?.name ?? 'Select repository' }}
            </span>
          </span>
          <ChevronDown class="size-4 shrink-0 opacity-50" />
        </Button>
      </ComboboxTrigger>

      <ComboboxList class="w-[280px]">
        <ComboboxInput
          placeholder="Search repositories..."
          class="h-9"
        />
        <ComboboxViewport class="p-1">
          <ComboboxEmpty>No repositories found.</ComboboxEmpty>

          <!-- Repository items -->
          <ComboboxItem
            v-for="repo in filteredRepos"
            :key="repo.id"
            :value="repo.id"
            class="group"
          >
            <Check
              class="size-4 shrink-0"
              :class="currentRepoId === repo.id ? 'opacity-100' : 'opacity-0'"
            />
            <div class="flex flex-1 flex-col gap-0.5 overflow-hidden">
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
          </ComboboxItem>

          <!-- Add repository option -->
          <ComboboxSeparator v-if="filteredRepos?.length" class="my-1" />
          <ComboboxItem
            value="__add__"
            class="text-muted-foreground"
          >
            <Plus class="size-4" />
            <span>Add repository...</span>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxList>
    </Combobox>

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
