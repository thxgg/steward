<script setup lang="ts">
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Button } from '~/components/ui/button'
import type { FileDiff, DiffHunk } from '~/types/git'

const props = defineProps<{
  /** Repository ID */
  repoId: string
  /** Commit SHA to display diff for */
  commitSha: string
}>()

const { fetchDiff, fetchFileDiff, isLoadingDiff, isLoadingFileDiff } = useGit()

// State
const files = ref<FileDiff[]>([])
const selectedFile = ref<string | undefined>()
const hunks = ref<DiffHunk[]>([])
const error = ref<string | null>(null)
const fileDiffError = ref<string | null>(null)

// Get the selected file's metadata
const selectedFileDiff = computed(() => files.value.find(f => f.path === selectedFile.value))

// Fetch file list on mount and when commitSha changes
async function loadDiff() {
  error.value = null
  files.value = []
  selectedFile.value = undefined
  hunks.value = []

  const result = await fetchDiff(props.repoId, props.commitSha)

  if (result.length === 0 && !isLoadingDiff.value) {
    // Check if it was an error (empty could be valid, but error is set by toast)
    // We'll set a generic message if truly no files
    error.value = null // Let empty state show naturally
  }

  files.value = result

  // Auto-select first file
  if (result.length > 0) {
    selectedFile.value = result[0]!.path
  }
}

// Fetch file diff when selection changes
async function loadFileDiff() {
  if (!selectedFile.value) {
    hunks.value = []
    return
  }

  fileDiffError.value = null
  const result = await fetchFileDiff(props.repoId, props.commitSha, selectedFile.value)
  hunks.value = result
}

// Handle file selection from minimap
function handleFileSelect(path: string) {
  selectedFile.value = path
}

// Retry loading
function retry() {
  loadDiff()
}

function retryFileDiff() {
  loadFileDiff()
}

// Watch for selection changes
watch(selectedFile, () => {
  loadFileDiff()
})

// Watch for prop changes
watch(
  () => [props.repoId, props.commitSha] as const,
  () => {
    loadDiff()
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Error state -->
    <div v-if="error" class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <AlertCircle class="size-12 text-destructive" />
      <div class="text-center">
        <p class="font-medium">Failed to load diff</p>
        <p class="text-sm text-muted-foreground">{{ error }}</p>
      </div>
      <Button variant="outline" size="sm" @click="retry">
        <RefreshCw class="mr-2 size-4" />
        Retry
      </Button>
    </div>

    <!-- Loading state (initial load) -->
    <div v-else-if="isLoadingDiff && files.length === 0" class="flex flex-1 items-center justify-center">
      <Loader2 class="size-8 animate-spin text-muted-foreground" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="files.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground"
    >
      <p>No files changed in this commit</p>
    </div>

    <!-- Main content -->
    <div v-else class="flex flex-1 overflow-hidden">
      <!-- Minimap sidebar -->
      <div class="w-56 shrink-0 border-r border-border">
        <div class="border-b border-border px-3 py-2">
          <span class="text-xs font-medium text-muted-foreground">
            {{ files.length }} file{{ files.length !== 1 ? 's' : '' }} changed
          </span>
        </div>
        <GitChangesMinimap
          :files="files"
          :selected-file="selectedFile"
          class="h-[calc(100%-2.5rem)]"
          @select="handleFileSelect"
        />
      </div>

      <!-- Diff viewer area -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- File header with rename support -->
        <div v-if="selectedFile" class="flex items-center gap-2 border-b border-border px-4 py-2">
          <span v-if="selectedFileDiff?.oldPath" class="truncate font-mono text-sm">
            <span class="text-muted-foreground">{{ selectedFileDiff.oldPath }}</span>
            <span class="mx-2 text-muted-foreground">→</span>
            <span>{{ selectedFile }}</span>
          </span>
          <span v-else class="truncate font-mono text-sm">{{ selectedFile }}</span>
          <span v-if="selectedFileDiff?.binary" class="ml-2 rounded bg-yellow-500/10 px-1.5 py-0.5 text-xs text-yellow-600 dark:text-yellow-400">
            binary
          </span>
        </div>

        <!-- File diff loading -->
        <div v-if="isLoadingFileDiff" class="flex flex-1 items-center justify-center">
          <Loader2 class="size-6 animate-spin text-muted-foreground" />
        </div>

        <!-- File diff error -->
        <div
          v-else-if="fileDiffError"
          class="flex flex-1 flex-col items-center justify-center gap-4 p-8"
        >
          <AlertCircle class="size-8 text-destructive" />
          <div class="text-center">
            <p class="text-sm font-medium">Failed to load file diff</p>
            <p class="text-xs text-muted-foreground">{{ fileDiffError }}</p>
          </div>
          <Button variant="outline" size="sm" @click="retryFileDiff">
            <RefreshCw class="mr-2 size-4" />
            Retry
          </Button>
        </div>

        <!-- Diff viewer -->
        <ScrollArea v-else-if="selectedFile" class="flex-1">
          <GitDiffViewer
            :hunks="hunks"
            :file-path="selectedFile"
            :binary="selectedFileDiff?.binary"
            :old-path="selectedFileDiff?.oldPath"
          />
        </ScrollArea>

        <!-- No file selected -->
        <div
          v-else
          class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          Select a file to view changes
        </div>
      </div>
    </div>
  </div>
</template>
