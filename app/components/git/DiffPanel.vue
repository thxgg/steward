<script setup lang="ts">
import { AlertCircle, RefreshCw, Loader2, Keyboard } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Button } from '~/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { createLatestRequestManager, isAbortError } from '~/lib/async-request'
import type { FileDiff, DiffHunk } from '~/types/git'

const props = defineProps<{
  /** Repository ID */
  repoId: string
  /** Commit SHA to display diff for */
  commitSha: string
  /** Optional relative path to git repo (for pseudo-monorepos) */
  repoPath?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { fetchCommits, fetchDiff, fetchFileDiff, fetchFileContent, isLoadingDiff, isLoadingFileDiff, isLoadingFileContent } = useGit()
const VIEW_MODE_STORAGE_KEY = 'steward-git-view-mode'

// State
const files = ref<FileDiff[]>([])
const selectedFile = ref<string | undefined>()
const hunks = ref<DiffHunk[]>([])
const fileContent = ref<string | null>(null)
const oldFileContent = ref<string | null>(null)
const parentCommitSha = ref<string | null>(null)
const error = ref<string | null>(null)
const fileDiffError = ref<string | null>(null)

// View mode: 'changes' shows only hunks, 'full' shows entire file with changes highlighted
const viewMode = ref<'changes' | 'full'>('changes')

const diffRequestManager = createLatestRequestManager()
const fileRequestManager = createLatestRequestManager()

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const fetchError = error as {
      data?: { message?: string; statusMessage?: string }
      statusMessage?: string
      message?: string
    }

    return fetchError.data?.message
      || fetchError.data?.statusMessage
      || fetchError.statusMessage
      || fetchError.message
      || fallback
  }

  return fallback
}

// Get the selected file's metadata
const selectedFileDiff = computed(() => files.value.find(f => f.path === selectedFile.value))
const canUseFullFileMode = computed(() => {
  const file = selectedFileDiff.value
  if (!file) {
    return true
  }

  if (file.binary) {
    return false
  }

  return file.status !== 'deleted'
})

const diffViewerKey = computed(() => `${props.repoPath || ''}:${props.commitSha}:${selectedFile.value || ''}`)

function resetDiffState() {
  error.value = null
  files.value = []
  selectedFile.value = undefined
  hunks.value = []
  fileContent.value = null
  oldFileContent.value = null
  parentCommitSha.value = null
  fileDiffError.value = null
}

// Fetch file list on mount and when commitSha changes
async function loadDiff() {
  const requestRepoId = props.repoId
  const requestCommitSha = props.commitSha
  const requestRepoPath = props.repoPath

  const ticket = diffRequestManager.begin()
  fileRequestManager.cancel()
  resetDiffState()

  try {
    const [result, commitsResult] = await Promise.all([
      fetchDiff(requestRepoId, requestCommitSha, {
        repoPath: requestRepoPath,
        signal: ticket.signal,
        suppressError: true
      }),
      fetchCommits(requestRepoId, [requestCommitSha], {
        repoPath: requestRepoPath,
        signal: ticket.signal,
        suppressError: true,
      })
    ])

    const isCurrentRequest = ticket.isCurrent()
      && props.repoId === requestRepoId
      && props.commitSha === requestCommitSha
      && props.repoPath === requestRepoPath

    if (!isCurrentRequest) {
      return
    }

    files.value = result
    parentCommitSha.value = commitsResult.commits[0]?.parentSha || null

    // Auto-select first file
    if (result.length > 0) {
      selectedFile.value = result[0]!.path
    }
  } catch (loadError) {
    if (isAbortError(loadError) || !ticket.isCurrent()) {
      return
    }

    error.value = getErrorMessage(loadError, 'Could not load commit diff.')
  } finally {
    diffRequestManager.clear(ticket)
  }
}

// Fetch file diff when selection changes
async function loadFileDiff() {
  const selectedPath = selectedFile.value
  if (!selectedPath) {
    fileDiffError.value = null
    hunks.value = []
    fileContent.value = null
    return
  }

  const requestRepoId = props.repoId
  const requestCommitSha = props.commitSha
  const requestRepoPath = props.repoPath
  const requestMode = viewMode.value
  const requestPath = selectedPath
  const requestParentCommitSha = parentCommitSha.value
  const requestFileStatus = selectedFileDiff.value?.status
  const requestOldPath = selectedFileDiff.value?.oldPath

  const ticket = fileRequestManager.begin()

  fileDiffError.value = null
  hunks.value = []
  fileContent.value = null
  oldFileContent.value = null

  const isCurrentRequest = () => {
    return ticket.isCurrent()
      && props.repoId === requestRepoId
      && props.commitSha === requestCommitSha
      && props.repoPath === requestRepoPath
      && viewMode.value === requestMode
      && selectedFile.value === requestPath
      && parentCommitSha.value === requestParentCommitSha
  }

  try {
    const diffPromise = fetchFileDiff(requestRepoId, requestCommitSha, requestPath, {
      repoPath: requestRepoPath,
      signal: ticket.signal,
      suppressError: true
    })

    if (requestMode === 'full') {
      const oldContentPromise = (() => {
        if (requestFileStatus === 'added') {
          return Promise.resolve('')
        }

        if (!requestParentCommitSha) {
          return Promise.resolve(null)
        }

        const oldFilePath = requestOldPath || requestPath

        return fetchFileContent(requestRepoId, requestParentCommitSha, oldFilePath, {
          repoPath: requestRepoPath,
          signal: ticket.signal,
          suppressError: true,
        }).catch((fetchError) => {
          if (isAbortError(fetchError)) {
            throw fetchError
          }

          return null
        })
      })()

      const [result, content, oldContent] = await Promise.all([
        diffPromise,
        fetchFileContent(requestRepoId, requestCommitSha, requestPath, {
          repoPath: requestRepoPath,
          signal: ticket.signal,
          suppressError: true
        }),
        oldContentPromise,
      ])

      if (!isCurrentRequest()) {
        return
      }

      hunks.value = result
      fileContent.value = content
      oldFileContent.value = oldContent
    } else {
      const result = await diffPromise

      if (!isCurrentRequest()) {
        return
      }

      hunks.value = result
      fileContent.value = null
      oldFileContent.value = null
    }
  } catch (loadError) {
    if (!isCurrentRequest() || isAbortError(loadError)) {
      return
    }

    fileDiffError.value = getErrorMessage(loadError, 'Could not load file diff.')
  } finally {
    fileRequestManager.clear(ticket)
  }
}

function setViewMode(nextMode: string | number | undefined) {
  if (nextMode !== 'changes' && nextMode !== 'full') {
    return
  }

  if (nextMode === 'full' && !canUseFullFileMode.value) {
    viewMode.value = 'changes'
    return
  }

  viewMode.value = nextMode
}

function restoreViewModePreference() {
  if (!import.meta.client) {
    return
  }

  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
  if (stored === 'changes' || stored === 'full') {
    viewMode.value = stored
  }
}

// Handle file selection from minimap
function handleFileSelect(path: string) {
  selectedFile.value = path
}

// Retry loading
function retry() {
  void loadDiff()
}

function retryFileDiff() {
  void loadFileDiff()
}

// Watch for selected file or view mode changes
watch(
  () => [selectedFile.value, viewMode.value] as const,
  () => {
    void loadFileDiff()
  }
)

watch(
  () => canUseFullFileMode.value,
  (canUseFullView) => {
    if (!canUseFullView && viewMode.value === 'full') {
      viewMode.value = 'changes'
    }
  },
  { immediate: true }
)

// Watch for prop changes
watch(
  () => [props.repoId, props.commitSha, props.repoPath] as const,
  () => {
    void loadDiff()
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

  const regularSeparators = Array.from(diffViewerRef.value.querySelectorAll('.diff-separator'))
  const shadowSeparators: Element[] = []

  const diffsContainers = diffViewerRef.value.querySelectorAll('diffs-container')
  for (const container of diffsContainers) {
    if (container instanceof HTMLElement && container.shadowRoot) {
      shadowSeparators.push(...Array.from(container.shadowRoot.querySelectorAll('[data-separator]')))
    }
  }

  const separators = [...regularSeparators, ...shadowSeparators]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)

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
  restoreViewModePreference()
  document.addEventListener('keydown', handleKeydown)
})

watch(viewMode, (mode) => {
  if (!import.meta.client) {
    return
  }

  localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
})

onUnmounted(() => {
  diffRequestManager.cancel()
  fileRequestManager.cancel()
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="panelRef" class="flex h-full flex-col overflow-hidden" tabindex="-1">
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
    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
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
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          <Tabs
            v-if="!selectedFileDiff?.binary"
            :model-value="viewMode"
            class="shrink-0 gap-0"
            @update:model-value="setViewMode"
          >
            <TabsList class="h-7 p-[2px]">
              <TabsTrigger value="changes" class="h-[calc(100%-1px)] px-2 text-xs">
                Changes
              </TabsTrigger>
              <TabsTrigger
                value="full"
                class="h-[calc(100%-1px)] px-2 text-xs"
                :disabled="!canUseFullFileMode"
                :title="selectedFileDiff?.status === 'deleted' ? 'Full file view is unavailable for deleted files.' : undefined"
              >
                Full file
              </TabsTrigger>
            </TabsList>
          </Tabs>
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

        <!-- Diff viewer (min-h-0 enables flex item to shrink for scrolling) -->
        <ScrollArea v-else-if="selectedFile" class="h-0 flex-1 overflow-hidden">
          <div ref="diffViewerRef">
            <GitDiffViewer
              :key="diffViewerKey"
              :hunks="hunks"
              :file-path="selectedFile"
              :binary="selectedFileDiff?.binary"
              :file-status="selectedFileDiff?.status"
              :old-path="selectedFileDiff?.oldPath"
              :file-content="fileContent"
              :old-file-content="oldFileContent"
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
