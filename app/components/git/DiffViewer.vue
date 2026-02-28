<script setup lang="ts">
import { AlertTriangle, ChevronDown, FileWarning } from 'lucide-vue-next'
import { File as PierreFile, FileDiff as PierreFileDiff, parseDiffFromFile, parsePatchFiles } from '@pierre/diffs'
import type { FileContents, FileDiffMetadata, SupportedLanguages, ThemeTypes } from '@pierre/diffs'
import { Button } from '~/components/ui/button'
import type { DiffHunk, FileStatus } from '~/types/git'

const props = defineProps<{
  /** Diff hunks to display */
  hunks: DiffHunk[]
  /** File path for syntax detection */
  filePath: string
  /** Whether this file is binary */
  binary?: boolean
  /** Original file path (for renames) */
  oldPath?: string
  /** Git file status */
  fileStatus?: FileStatus
  /** Full file content (for full file view) */
  fileContent?: string | null
  /** Parent commit file content (for full file diff rendering) */
  oldFileContent?: string | null
  /** Whether to show full file with changes highlighted */
  showFullFile?: boolean
  /** Loading state for file content */
  isLoadingContent?: boolean
}>()

const { resolvedTheme } = useThemeMode()

const LINE_LIMIT = 10000
const DIFF_LAYOUT_STORAGE_KEY = 'steward-git-diff-layout'

const showAll = ref(false)
const diffLayout = ref<'split' | 'unified'>('split')
const diffMountRef = ref<HTMLElement | null>(null)

const parseError = ref<string | null>(null)
const parsedDiff = ref<FileDiffMetadata | null>(null)
const fullDiffParseError = ref<string | null>(null)
const parsedFullDiff = ref<FileDiffMetadata | null>(null)

let pierreDiffInstance: PierreFileDiff | null = null
let pierreFileInstance: PierreFile | null = null

watch(
  () => props.filePath,
  () => {
    showAll.value = false
  }
)

const totalLines = computed(() => {
  let count = 0
  for (const hunk of props.hunks) {
    count += hunk.lines.length
  }
  return count
})

const isLargeFile = computed(() => totalLines.value > LINE_LIMIT)
const isEmpty = computed(() => props.hunks.length === 0 && !props.binary)

const hasFullFileContent = computed(() => {
  return props.fileContent !== null && props.fileContent !== undefined
})

const isWaitingForFullFile = computed(() => {
  return Boolean(props.showFullFile && !hasFullFileContent.value)
})

const shouldShowFullFile = computed(() => {
  return Boolean(props.showFullFile && hasFullFileContent.value)
})

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    vue: 'vue',
    svelte: 'svelte',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    dart: 'dart',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    md: 'markdown',
    mdx: 'mdx',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'fish',
    ps1: 'powershell',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  }

  return langMap[ext] || 'text'
}

const language = computed<SupportedLanguages>(() => detectLanguage(props.filePath) as SupportedLanguages)

function cleanupPierreDiff() {
  if (pierreDiffInstance) {
    pierreDiffInstance.cleanUp()
    pierreDiffInstance = null
  }
}

function cleanupPierreFile() {
  if (pierreFileInstance) {
    pierreFileInstance.cleanUp()
    pierreFileInstance = null
  }
}

function cleanupPierreInstances() {
  cleanupPierreDiff()
  cleanupPierreFile()
}

function setDiffLayout(layout: 'split' | 'unified') {
  diffLayout.value = layout
}

function restoreDiffLayoutPreference() {
  if (!import.meta.client) {
    return
  }

  const stored = localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)
  if (stored === 'split' || stored === 'unified') {
    diffLayout.value = stored
  }
}

function normalizePatchPath(path: string): string {
  if (!path) {
    return '/dev/null'
  }

  return path.replace(/\r?\n/g, '')
}

function resolvePatchEndpoints(filePath: string, oldPath: string | undefined, status: FileStatus | undefined): {
  oldPath: string
  newPath: string
} {
  switch (status) {
    case 'added':
      return {
        oldPath: '/dev/null',
        newPath: filePath,
      }
    case 'deleted':
      return {
        oldPath: oldPath || filePath,
        newPath: '/dev/null',
      }
    default:
      return {
        oldPath: oldPath || filePath,
        newPath: filePath,
      }
  }
}

function createUnifiedPatchFromHunks(
  hunks: DiffHunk[],
  filePath: string,
  oldPath: string | undefined,
  status: FileStatus | undefined
): string {
  const endpoints = resolvePatchEndpoints(filePath, oldPath, status)
  const patchLines: string[] = [
    `--- ${normalizePatchPath(endpoints.oldPath)}`,
    `+++ ${normalizePatchPath(endpoints.newPath)}`,
  ]

  for (const hunk of hunks) {
    patchLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)

    for (const line of hunk.lines) {
      if (line.type === 'add') {
        patchLines.push(`+${line.content}`)
      } else if (line.type === 'remove') {
        patchLines.push(`-${line.content}`)
      } else {
        patchLines.push(` ${line.content}`)
      }
    }
  }

  return `${patchLines.join('\n')}\n`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Could not parse diff data.'
}

watch(
  () => [props.hunks, props.filePath, props.oldPath, props.fileStatus] as const,
  ([hunks, filePath, oldPath, fileStatus]) => {
    parseError.value = null

    if (hunks.length === 0) {
      parsedDiff.value = null
      return
    }

    try {
      const patch = createUnifiedPatchFromHunks(hunks, filePath, oldPath, fileStatus)
      const parsedPatches = parsePatchFiles(patch, `steward-${filePath}`)
      const fileDiff = parsedPatches[0]?.files[0] || null

      if (!fileDiff) {
        parsedDiff.value = null
        parseError.value = 'Could not parse patch into a renderable diff.'
        return
      }

      parsedDiff.value = fileDiff
    } catch (error) {
      parsedDiff.value = null
      parseError.value = getErrorMessage(error)
    }
  },
  { immediate: true }
)

const fullFileNewData = computed<FileContents | null>(() => {
  if (!shouldShowFullFile.value || props.fileContent === null || props.fileContent === undefined) {
    return null
  }

  return {
    name: props.filePath,
    contents: props.fileContent,
    lang: language.value,
  }
})

const fullFileOldData = computed<FileContents | null>(() => {
  if (!shouldShowFullFile.value) {
    return null
  }

  if (props.fileStatus === 'added') {
    return {
      name: props.oldPath || props.filePath,
      contents: '',
      lang: language.value,
    }
  }

  if (props.oldFileContent === null || props.oldFileContent === undefined) {
    return null
  }

  return {
    name: props.oldPath || props.filePath,
    contents: props.oldFileContent,
    lang: language.value,
  }
})

watch(
  () => [fullFileOldData.value, fullFileNewData.value] as const,
  ([oldFile, newFile]) => {
    fullDiffParseError.value = null
    parsedFullDiff.value = null

    if (!oldFile || !newFile) {
      return
    }

    try {
      parsedFullDiff.value = parseDiffFromFile(oldFile, newFile, {
        context: Number.MAX_SAFE_INTEGER,
      })
    } catch (error) {
      fullDiffParseError.value = getErrorMessage(error)
      parsedFullDiff.value = null
    }
  },
  { immediate: true }
)

const shouldRenderPierreDiff = computed(() => {
  if (shouldShowFullFile.value) {
    return false
  }

  if (props.binary || isEmpty.value) {
    return false
  }

  if (isLargeFile.value && !showAll.value) {
    return false
  }

  return parsedDiff.value !== null
})

const shouldRenderPierreFullDiff = computed(() => {
  return Boolean(shouldShowFullFile.value && !props.binary && parsedFullDiff.value)
})

const shouldRenderPierreFileFallback = computed(() => {
  return Boolean(shouldShowFullFile.value && !props.binary && fullFileNewData.value && !parsedFullDiff.value)
})

const diffOptions = computed(() => {
  const themeType: ThemeTypes = resolvedTheme.value

  return {
    diffStyle: diffLayout.value,
    hunkSeparators: 'line-info' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word-alt' as const,
    overflow: 'scroll' as const,
    themeType,
    disableFileHeader: true,
  }
})

const fullDiffOptions = computed(() => {
  const themeType: ThemeTypes = resolvedTheme.value

  return {
    diffStyle: 'unified' as const,
    hunkSeparators: 'line-info' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word-alt' as const,
    overflow: 'scroll' as const,
    themeType,
    disableFileHeader: true,
  }
})

const fileOptions = computed(() => {
  const themeType: ThemeTypes = resolvedTheme.value

  return {
    overflow: 'scroll' as const,
    themeType,
    disableFileHeader: true,
  }
})

function renderPierreDiff() {
  const mountNode = diffMountRef.value
  const fileDiff = parsedDiff.value

  if (!mountNode || !shouldRenderPierreDiff.value || !fileDiff) {
    cleanupPierreDiff()
    return
  }

  cleanupPierreFile()

  if (!pierreDiffInstance) {
    pierreDiffInstance = new PierreFileDiff(diffOptions.value)
  } else {
    pierreDiffInstance.setOptions(diffOptions.value)
  }

  pierreDiffInstance.render({
    fileDiff,
    containerWrapper: mountNode,
    forceRender: true,
  })
}

function renderPierreFullDiff() {
  const mountNode = diffMountRef.value
  const fileDiff = parsedFullDiff.value

  if (!mountNode || !shouldRenderPierreFullDiff.value || !fileDiff) {
    cleanupPierreDiff()
    return
  }

  cleanupPierreFile()

  if (!pierreDiffInstance) {
    pierreDiffInstance = new PierreFileDiff(fullDiffOptions.value)
  } else {
    pierreDiffInstance.setOptions(fullDiffOptions.value)
  }

  pierreDiffInstance.render({
    fileDiff,
    containerWrapper: mountNode,
    forceRender: true,
  })
}

function renderPierreFileFallback() {
  const mountNode = diffMountRef.value
  const file = fullFileNewData.value

  if (!mountNode || !shouldRenderPierreFileFallback.value || !file) {
    cleanupPierreFile()
    return
  }

  cleanupPierreDiff()

  if (!pierreFileInstance) {
    pierreFileInstance = new PierreFile(fileOptions.value)
  } else {
    pierreFileInstance.setOptions(fileOptions.value)
  }

  pierreFileInstance.render({
    file,
    containerWrapper: mountNode,
    forceRender: true,
  })
}

watch(
  () => [
    shouldRenderPierreDiff.value,
    shouldRenderPierreFullDiff.value,
    shouldRenderPierreFileFallback.value,
    parsedDiff.value,
    parsedFullDiff.value,
    fullFileNewData.value,
    diffLayout.value,
    resolvedTheme.value,
    fullDiffParseError.value,
    diffMountRef.value,
  ] as const,
  async () => {
    await nextTick()

    if (shouldRenderPierreFullDiff.value) {
      renderPierreFullDiff()
      return
    }

    if (shouldRenderPierreFileFallback.value) {
      renderPierreFileFallback()
      return
    }

    if (shouldRenderPierreDiff.value) {
      renderPierreDiff()
      return
    }

    cleanupPierreInstances()
  },
  { immediate: true }
)

onUnmounted(() => {
  cleanupPierreInstances()
})

onMounted(() => {
  restoreDiffLayoutPreference()
})

watch(diffLayout, (layout) => {
  if (!import.meta.client) {
    return
  }

  localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout)
})
</script>

<template>
  <div class="diff-viewer">
    <div
      v-if="isWaitingForFullFile && !binary"
      class="flex items-center justify-center py-8"
    >
      <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <div v-else-if="binary" class="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <FileWarning class="size-10 opacity-50" />
      <div class="text-center">
        <p class="font-medium">Binary file</p>
        <p class="text-sm">This file cannot be displayed as a diff</p>
      </div>
    </div>

    <div v-else-if="isEmpty && !showFullFile" class="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <AlertTriangle class="size-10 opacity-50" />
      <div class="text-center">
        <p class="font-medium">No changes</p>
        <p class="text-sm">This file was touched but has no content changes</p>
      </div>
    </div>

    <div v-else-if="isLargeFile && !showAll && !showFullFile" class="diff-container">
      <div class="flex flex-col items-center justify-center gap-3 border-b border-border bg-muted/30 py-6">
        <AlertTriangle class="size-8 text-yellow-500" />
        <div class="text-center">
          <p class="font-medium">Large file</p>
          <p class="text-sm text-muted-foreground">
            This file has {{ totalLines.toLocaleString() }} lines (threshold: {{ LINE_LIMIT.toLocaleString() }})
          </p>
        </div>
        <Button variant="outline" size="sm" @click="showAll = true">
          <ChevronDown class="mr-2 size-4" />
          Show full diff
        </Button>
      </div>
    </div>

    <div v-else-if="parseError && !showFullFile" class="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <AlertTriangle class="size-10 opacity-50" />
      <div class="text-center">
        <p class="font-medium">Failed to render diff</p>
        <p class="text-sm">{{ parseError }}</p>
      </div>
    </div>

    <div v-else class="diff-container">
      <div v-if="!showFullFile" class="diff-toolbar">
        <Button
          size="sm"
          :variant="diffLayout === 'split' ? 'secondary' : 'ghost'"
          class="h-7 px-2.5 text-xs"
          @click="setDiffLayout('split')"
        >
          Split
        </Button>
        <Button
          size="sm"
          :variant="diffLayout === 'unified' ? 'secondary' : 'ghost'"
          class="h-7 px-2.5 text-xs"
          @click="setDiffLayout('unified')"
        >
          Unified
        </Button>
      </div>
      <div ref="diffMountRef" class="pierre-diff-host" />
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: hsl(var(--foreground));
}

.diff-container {
  overflow-x: auto;
}

.diff-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
}

.pierre-diff-host {
  min-height: 3rem;
}

:deep(diffs-container) {
  display: block;
  width: 100%;
}
</style>
