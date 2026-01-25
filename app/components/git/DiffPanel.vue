<script setup lang="ts">
import { AlertCircle, RefreshCw, Loader2, Keyboard, FileCode, FileDiff as FileDiffIcon } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Button } from '~/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import type { FileDiff, DiffHunk } from '~/types/git'

const props = defineProps<{
  /** Repository ID */
  repoId: string
  /** Commit SHA to display diff for */
  commitSha: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { fetchDiff, fetchFileDiff, fetchFileContent, isLoadingDiff, isLoadingFileDiff, isLoadingFileContent } = useGit()

// State
const files = ref<FileDiff[]>([])
const selectedFile = ref<string | undefined>()
const hunks = ref<DiffHunk[]>([])
const fileContent = ref<string | null>(null)
const error = ref<string | null>(null)
const fileDiffError = ref<string | null>(null)

// View mode: 'changes' shows only hunks, 'full' shows entire file with changes highlighted
const viewMode = ref<'changes' | 'full'>('changes')

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
    fileContent.value = null
    return
  }

  fileDiffError.value = null

  // Fetch hunks (always needed for highlighting changes)
  const result = await fetchFileDiff(props.repoId, props.commitSha, selectedFile.value)
  hunks.value = result

  // Fetch full file content if in full mode
  if (viewMode.value === 'full') {
    const content = await fetchFileContent(props.repoId, props.commitSha, selectedFile.value)
    fileContent.value = content
  }
}

// Toggle view mode
function toggleViewMode() {
  viewMode.value = viewMode.value === 'changes' ? 'full' : 'changes'
}

// Reload file content when switching to full mode
watch(viewMode, async (mode) => {
  if (mode === 'full' && selectedFile.value && !fileContent.value) {
    const content = await fetchFileContent(props.repoId, props.commitSha, selectedFile.value)
    fileContent.value = content
  }
})

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

// Keyboard navigation
const panelRef = ref<HTMLElement | null>(null)
const diffViewerRef = ref<HTMLElement | null>(null)

// Navigate to next/previous file
function navigateFile(direction: 'next' | 'prev') {
  if (files.value.length === 0) return

  const currentIndex = selectedFile.value
    ? files.value.findIndex(f => f.path === selectedFile.value)
    : -1

  let newIndex: number
  if (direction === 'next') {
    newIndex = currentIndex < files.value.length - 1 ? currentIndex + 1 : 0
  } else {
    newIndex = currentIndex > 0 ? currentIndex - 1 : files.value.length - 1
  }

  const file = files.value[newIndex]
  if (file) {
    selectedFile.value = file.path
  }
}

// Jump between hunks
function jumpToHunk(direction: 'next' | 'prev') {
  if (!diffViewerRef.value) return

  const separators = diffViewerRef.value.querySelectorAll('.diff-separator')
  if (separators.length === 0) return

  const container = diffViewerRef.value.closest('.overflow-y-auto, [data-radix-scroll-area-viewport]')
  if (!container) return

  const scrollTop = container.scrollTop
  const containerRect = container.getBoundingClientRect()

  let targetSeparator: Element | null = null

  if (direction === 'next') {
    // Find the first separator below current scroll position
    for (const sep of separators) {
      const rect = sep.getBoundingClientRect()
      const relativeTop = rect.top - containerRect.top + scrollTop
      if (relativeTop > scrollTop + 50) {
        targetSeparator = sep
        break
      }
    }
    // If no separator found below, wrap to first
    if (!targetSeparator && separators.length > 0) {
      targetSeparator = separators[0]!
    }
  } else {
    // Find the last separator above current scroll position
    for (let i = separators.length - 1; i >= 0; i--) {
      const sep = separators[i]!
      const rect = sep.getBoundingClientRect()
      const relativeTop = rect.top - containerRect.top + scrollTop
      if (relativeTop < scrollTop - 10) {
        targetSeparator = sep
        break
      }
    }
    // If no separator found above, wrap to last
    if (!targetSeparator && separators.length > 0) {
      targetSeparator = separators[separators.length - 1]!
    }
  }

  if (targetSeparator) {
    targetSeparator.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// Handle keyboard events
function handleKeydown(event: KeyboardEvent) {
  // Skip if user is typing in an input
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return
  }

  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        navigateFile('next')
      }
      break
    case 'k':
    case 'ArrowUp':
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        navigateFile('prev')
      }
      break
    case '[':
      event.preventDefault()
      jumpToHunk('prev')
      break
    case ']':
      event.preventDefault()
      jumpToHunk('next')
      break
    case 'Escape':
      event.preventDefault()
      emit('close')
      break
  }
}

// Set up keyboard listeners when mounted
onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="panelRef" class="flex h-full flex-col" tabindex="-1">
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
      <div class="flex w-56 shrink-0 flex-col border-r border-border">
        <div class="flex items-center justify-between border-b border-border px-3 py-2">
          <span class="text-xs font-medium text-muted-foreground">
            {{ files.length }} file{{ files.length !== 1 ? 's' : '' }} changed
          </span>
          <!-- Keyboard shortcuts hint -->
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <button class="text-muted-foreground/50 transition-colors hover:text-muted-foreground">
                  <Keyboard class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" class="max-w-xs">
                <div class="space-y-1 text-xs">
                  <div class="flex justify-between gap-4">
                    <span class="text-muted-foreground">Navigate files</span>
                    <span class="font-mono">j/k or ↑/↓</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-muted-foreground">Jump to hunk</span>
                    <span class="font-mono">[ / ]</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-muted-foreground">Close</span>
                    <span class="font-mono">Esc</span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <GitChangesMinimap
            :files="files"
            :selected-file="selectedFile"
            @select="handleFileSelect"
          />
        </div>
      </div>

      <!-- Diff viewer area -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- File header with rename support -->
        <div v-if="selectedFile" class="flex items-center gap-2 border-b border-border px-4 py-2">
          <span v-if="selectedFileDiff?.oldPath" class="min-w-0 flex-1 truncate font-mono text-sm">
            <span class="text-muted-foreground">{{ selectedFileDiff.oldPath }}</span>
            <span class="mx-2 text-muted-foreground">→</span>
            <span>{{ selectedFile }}</span>
          </span>
          <span v-else class="min-w-0 flex-1 truncate font-mono text-sm">{{ selectedFile }}</span>
          <span v-if="selectedFileDiff?.binary" class="rounded bg-yellow-500/10 px-1.5 py-0.5 text-xs text-yellow-600 dark:text-yellow-400">
            binary
          </span>
          <!-- View mode toggle -->
          <TooltipProvider v-if="!selectedFileDiff?.binary">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 shrink-0 gap-1.5 text-xs"
                  @click="toggleViewMode"
                >
                  <component :is="viewMode === 'changes' ? FileDiffIcon : FileCode" class="size-3.5" />
                  {{ viewMode === 'changes' ? 'Changes' : 'Full file' }}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{ viewMode === 'changes' ? 'Show full file with changes' : 'Show changes only' }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          <div ref="diffViewerRef">
            <GitDiffViewer
              :hunks="hunks"
              :file-path="selectedFile"
              :binary="selectedFileDiff?.binary"
              :old-path="selectedFileDiff?.oldPath"
              :file-content="fileContent"
              :show-full-file="viewMode === 'full'"
              :is-loading-content="isLoadingFileContent"
            />
          </div>
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
