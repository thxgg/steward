<script setup lang="ts">
import { Link, Link2Off, FileWarning, AlertTriangle, ChevronDown } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { DiffHunk, DiffLine } from '~/types/git'

type CodeToHtmlFn = (code: string, options: {
  lang: string
  themes: {
    light: string
    dark: string
  }
}) => Promise<string>

const props = defineProps<{
  /** Diff hunks to display */
  hunks: DiffHunk[]
  /** File path for syntax detection */
  filePath: string
  /** Whether this file is binary */
  binary?: boolean
  /** Old file path (for renames) */
  oldPath?: string
  /** Full file content (for full file view) */
  fileContent?: string | null
  /** Whether to show full file with changes highlighted */
  showFullFile?: boolean
  /** Loading state for file content */
  isLoadingContent?: boolean
}>()

// Line limit for large files (truncation threshold)
const LINE_LIMIT = 10000
const MAX_DIFF_HIGHLIGHT_LINES = 1500
const MAX_FULL_FILE_HIGHLIGHT_LINES = 4000
const showAll = ref(false)

// Synchronized scrolling state
const syncScrollEnabled = ref(true)

// Refs for scroll sync
const leftScrollRef = ref<HTMLElement | null>(null)
const rightScrollRef = ref<HTMLElement | null>(null)
const isScrolling = ref(false)

// Scroll sync handlers
function onLeftScroll(event: Event) {
  if (!syncScrollEnabled.value || isScrolling.value) return
  const target = event.target as HTMLElement
  if (rightScrollRef.value) {
    isScrolling.value = true
    rightScrollRef.value.scrollLeft = target.scrollLeft
    requestAnimationFrame(() => {
      isScrolling.value = false
    })
  }
}

function onRightScroll(event: Event) {
  if (!syncScrollEnabled.value || isScrolling.value) return
  const target = event.target as HTMLElement
  if (leftScrollRef.value) {
    isScrolling.value = true
    leftScrollRef.value.scrollLeft = target.scrollLeft
    requestAnimationFrame(() => {
      isScrolling.value = false
    })
  }
}

// Calculate total line count for large file detection
const totalLines = computed(() => {
  let count = 0
  for (const hunk of props.hunks) {
    count += hunk.lines.length
  }
  return count
})

// Check if file is large and should be truncated
const isLargeFile = computed(() => totalLines.value > LINE_LIMIT)

// Check if file has no actual changes (empty diff)
const isEmpty = computed(() => props.hunks.length === 0 && !props.binary)

// Build a set of changed line numbers for full file highlighting
const changedLines = computed(() => {
  const added = new Set<number>()
  const removed = new Set<number>()

  for (const hunk of props.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' && line.newNumber !== undefined) {
        added.add(line.newNumber)
      }
      if (line.type === 'remove' && line.oldNumber !== undefined) {
        removed.add(line.oldNumber)
      }
    }
  }

  return { added, removed }
})

// Full file lines for the full file view
const fullFileLines = computed(() => {
  if (!props.fileContent) return []
  return props.fileContent.split('\n')
})

// Detect language from file extension
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

// Detect language from file path
const language = computed(() => detectLanguage(props.filePath))

// Highlighted lines state
const highlightedLines = ref<Map<string, string>>(new Map())
const isLoading = ref(true)
const lineHighlightCache = new Map<string, string>()
let codeToHtmlLoader: Promise<CodeToHtmlFn> | null = null

async function getCodeToHtml(): Promise<CodeToHtmlFn> {
  if (!codeToHtmlLoader) {
    codeToHtmlLoader = import('shiki').then((module) => module.codeToHtml as CodeToHtmlFn)
  }

  return codeToHtmlLoader
}

// Generate line pairs for side-by-side view
interface LinePair {
  id: string
  left: {
    lineNum?: number
    content: string
    type: 'add' | 'remove' | 'context' | 'empty'
    highlighted?: string
  }
  right: {
    lineNum?: number
    content: string
    type: 'add' | 'remove' | 'context' | 'empty'
    highlighted?: string
  }
}

interface DisplayItem {
  type: 'line' | 'separator'
  pair?: LinePair
  hunkIndex?: number
}

// Generate display items including line pairs and separators
const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []

  for (let hunkIndex = 0; hunkIndex < props.hunks.length; hunkIndex++) {
    const hunk = props.hunks[hunkIndex]!

    // Add separator before each hunk (except the first)
    if (hunkIndex > 0) {
      items.push({ type: 'separator', hunkIndex })
    }

    // Process lines into pairs
    const hunkLines = hunk.lines
    let i = 0

    while (i < hunkLines.length) {
      const line = hunkLines[i]!

      if (line.type === 'context') {
        // Context line - show on both sides
        items.push({
          type: 'line',
          pair: {
            id: `${hunkIndex}-${i}`,
            left: {
              lineNum: line.oldNumber,
              content: line.content,
              type: 'context',
            },
            right: {
              lineNum: line.newNumber,
              content: line.content,
              type: 'context',
            },
          },
        })
        i++
      } else if (line.type === 'remove') {
        // Check for consecutive additions after removals to pair them
        const removeLines: DiffLine[] = []
        const addLines: DiffLine[] = []

        // Collect consecutive removals
        while (i < hunkLines.length && hunkLines[i]!.type === 'remove') {
          removeLines.push(hunkLines[i]!)
          i++
        }

        // Collect consecutive additions
        while (i < hunkLines.length && hunkLines[i]!.type === 'add') {
          addLines.push(hunkLines[i]!)
          i++
        }

        // Pair up removals and additions
        const maxLen = Math.max(removeLines.length, addLines.length)
        for (let j = 0; j < maxLen; j++) {
          const removeLine = removeLines[j]
          const addLine = addLines[j]

          items.push({
            type: 'line',
            pair: {
              id: `${hunkIndex}-${i - maxLen + j}`,
              left: removeLine
                ? {
                    lineNum: removeLine.oldNumber,
                    content: removeLine.content,
                    type: 'remove',
                  }
                : { content: '', type: 'empty' },
              right: addLine
                ? {
                    lineNum: addLine.newNumber,
                    content: addLine.content,
                    type: 'add',
                  }
                : { content: '', type: 'empty' },
            },
          })
        }
      } else if (line.type === 'add') {
        // Standalone addition (shouldn't happen often in this flow)
        items.push({
          type: 'line',
          pair: {
            id: `${hunkIndex}-${i}`,
            left: { content: '', type: 'empty' },
            right: {
              lineNum: line.newNumber,
              content: line.content,
              type: 'add',
            },
          },
        })
        i++
      } else {
        i++
      }
    }
  }

  return items
})

// Highlight code with shiki using dual themes for instant theme switching
async function highlightLine(content: string, lang: string): Promise<string> {
  if (!content.trim()) {
    return ''
  }

  const cacheKey = `${lang}:${content}`
  const cached = lineHighlightCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  try {
    const codeToHtml = await getCodeToHtml()
    const html = await codeToHtml(content, {
      lang,
      themes: {
        light: 'catppuccin-latte',
        dark: 'catppuccin-mocha',
      },
    })
    // Extract just the code content from shiki output
    // Shiki wraps in <pre><code>...</code></pre>
    const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/)
    const highlighted = codeMatch ? codeMatch[1] || '' : escapeHtml(content)
    lineHighlightCache.set(cacheKey, highlighted)
    return highlighted
  } catch {
    const fallback = escapeHtml(content)
    lineHighlightCache.set(cacheKey, fallback)
    return fallback
  }
}

// Highlight full file content at once (preserves context for Vue/JSX files)
// then split into individual lines
async function highlightFullContent(content: string, lang: string): Promise<string[]> {
  if (!content) {
    return []
  }

  const lines = content.split('\n')
  if (lines.length > MAX_FULL_FILE_HIGHLIGHT_LINES) {
    return lines.map(escapeHtml)
  }

  try {
    const codeToHtml = await getCodeToHtml()
    const html = await codeToHtml(content, {
      lang,
      themes: {
        light: 'catppuccin-latte',
        dark: 'catppuccin-mocha',
      },
    })
    // Extract the code content from shiki output
    const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/)
    if (!codeMatch || !codeMatch[1]) {
      return lines.map(escapeHtml)
    }

    // Split by newlines, preserving HTML tags that span lines
    // Shiki outputs each line's content, with newlines as literal \n
    const highlightedContent = codeMatch[1]
    return highlightedContent.split('\n')
  } catch {
    return lines.map(escapeHtml)
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Highlighted full file lines (used for both full file view and diff view)
const highlightedFullFile = ref<string[]>([])
const isLoadingFullFile = ref(false)

// Highlight full file when content changes
// Uses full-content highlighting to preserve context (important for Vue/JSX)
watch(
  () => [props.fileContent, props.filePath] as const,
  async ([content]) => {
    if (!content) {
      highlightedFullFile.value = []
      return
    }

    isLoadingFullFile.value = true
    const lang = language.value

    // Highlight entire file at once to preserve context for Vue/JSX files
    highlightedFullFile.value = await highlightFullContent(content, lang)
    isLoadingFullFile.value = false
  },
  { immediate: true }
)

// Highlight diff lines - uses full file context when available
watch(
  () => [props.hunks, props.filePath, highlightedFullFile.value] as const,
  async () => {
    isLoading.value = true
    const lang = language.value
    const newHighlighted = new Map<string, string>()
    const fullFileLines = highlightedFullFile.value

    // Collect lines that need individual highlighting (removed lines from old file)
    const linesToHighlight: { key: string; content: string }[] = []

    for (const item of displayItems.value) {
      if (item.type === 'line' && item.pair) {
        // Left side (old file) - removed lines need individual highlighting
        if (item.pair.left.content && item.pair.left.type !== 'empty') {
          const key = `${item.pair.id}-old`
          // For context lines, we can use the new file's highlighting if line numbers match
          if (item.pair.left.type === 'context' && item.pair.left.lineNum && fullFileLines.length > 0) {
            // Context lines exist in both files at same content, use new file highlight
            const lineIndex = item.pair.right.lineNum ? item.pair.right.lineNum - 1 : -1
            if (lineIndex >= 0 && lineIndex < fullFileLines.length) {
              newHighlighted.set(key, fullFileLines[lineIndex] || '')
            } else {
              linesToHighlight.push({ key, content: item.pair.left.content })
            }
          } else {
            // Removed lines - must highlight individually
            linesToHighlight.push({ key, content: item.pair.left.content })
          }
        }

        // Right side (new file) - use full file highlighting when available
        if (item.pair.right.content && item.pair.right.type !== 'empty') {
          const key = `${item.pair.id}-new`
          const lineNum = item.pair.right.lineNum
          if (lineNum && fullFileLines.length > 0 && lineNum <= fullFileLines.length) {
            // Use pre-highlighted line from full file
            newHighlighted.set(key, fullFileLines[lineNum - 1] || '')
          } else {
            // Fallback to individual highlighting
            linesToHighlight.push({ key, content: item.pair.right.content })
          }
        }
      }
    }

    // Highlight remaining lines individually (removed lines)
    const limitedLines = linesToHighlight.slice(0, MAX_DIFF_HIGHLIGHT_LINES)
    const overflowLines = linesToHighlight.slice(MAX_DIFF_HIGHLIGHT_LINES)

    for (const { key, content } of overflowLines) {
      newHighlighted.set(key, escapeHtml(content))
    }

    const batchSize = 50
    for (let i = 0; i < limitedLines.length; i += batchSize) {
      const batch = limitedLines.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(async ({ key, content }) => {
          const result = await highlightLine(content, lang)
          return { key, result }
        })
      )

      for (const { key, result } of results) {
        newHighlighted.set(key, result)
      }
    }

    highlightedLines.value = newHighlighted
    isLoading.value = false
  },
  { immediate: true }
)

// Get highlighted content for a line
function getHighlightedContent(pairId: string, side: 'old' | 'new'): string {
  return highlightedLines.value.get(`${pairId}-${side}`) || ''
}

// Get line type for full file view
function getFullFileLineType(lineNum: number): 'add' | 'remove' | 'context' {
  if (changedLines.value.added.has(lineNum)) return 'add'
  return 'context'
}
</script>

<template>
  <div class="diff-viewer">
    <!-- Loading state -->
    <div v-if="(isLoading || isLoadingContent || isLoadingFullFile) && !binary" class="flex items-center justify-center py-8">
      <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <!-- Binary file state -->
    <div v-else-if="binary" class="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <FileWarning class="size-10 opacity-50" />
      <div class="text-center">
        <p class="font-medium">Binary file</p>
        <p class="text-sm">This file cannot be displayed as a diff</p>
      </div>
    </div>

    <!-- Empty diff state (only for changes view) -->
    <div v-else-if="isEmpty && !showFullFile" class="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <AlertTriangle class="size-10 opacity-50" />
      <div class="text-center">
        <p class="font-medium">No changes</p>
        <p class="text-sm">This file was touched but has no content changes</p>
      </div>
    </div>

    <!-- Large file warning (truncated) - only for changes view -->
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

    <!-- Full file view -->
    <div v-else-if="showFullFile && fileContent" class="diff-container">
      <div class="full-file-view">
        <div
          v-for="(line, index) in fullFileLines"
          :key="index"
          class="full-file-line"
          :class="{
            'diff-add': getFullFileLineType(index + 1) === 'add',
          }"
        >
          <div class="diff-gutter">
            <span class="line-number">{{ index + 1 }}</span>
          </div>
          <div class="diff-content">
            <span
              class="diff-code"
              v-html="highlightedFullFile[index] || escapeHtml(line)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Normal diff view (changes only) -->
    <div v-else class="diff-container">
      <!-- Sync scroll toggle -->
      <div class="diff-toolbar">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 text-xs"
          :class="{ 'text-primary': syncScrollEnabled }"
          @click="syncScrollEnabled = !syncScrollEnabled"
        >
          <component :is="syncScrollEnabled ? Link : Link2Off" class="size-3.5" />
          {{ syncScrollEnabled ? 'Sync scroll' : 'Scroll unlocked' }}
        </Button>
      </div>
      <!-- Side-by-side view with independent scrollable columns -->
      <div class="diff-split">
        <!-- Left column (old) -->
        <div ref="leftScrollRef" class="diff-column diff-column-left" @scroll="onLeftScroll">
          <div class="diff-column-content">
            <template v-for="item in displayItems" :key="item.type === 'line' ? `left-${item.pair?.id}` : `left-sep-${item.hunkIndex}`">
              <!-- Hunk separator -->
              <div v-if="item.type === 'separator'" class="diff-separator-half">
                <div class="separator-line" />
                <span class="separator-text">···</span>
              </div>

              <!-- Line -->
              <div
                v-else-if="item.pair"
                class="diff-line"
                :class="{
                  'diff-remove': item.pair.left.type === 'remove',
                  'diff-empty': item.pair.left.type === 'empty',
                  'diff-context': item.pair.left.type === 'context',
                }"
              >
                <div class="diff-gutter">
                  <span v-if="item.pair.left.lineNum" class="line-number">
                    {{ item.pair.left.lineNum }}
                  </span>
                </div>
                <div class="diff-content">
                  <span
                    v-if="item.pair.left.type !== 'empty'"
                    class="diff-code"
                    v-html="getHighlightedContent(item.pair.id, 'old') || escapeHtml(item.pair.left.content)"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Right column (new) -->
        <div ref="rightScrollRef" class="diff-column diff-column-right" @scroll="onRightScroll">
          <div class="diff-column-content">
            <template v-for="item in displayItems" :key="item.type === 'line' ? `right-${item.pair?.id}` : `right-sep-${item.hunkIndex}`">
              <!-- Hunk separator -->
              <div v-if="item.type === 'separator'" class="diff-separator-half">
                <span class="separator-text">···</span>
                <div class="separator-line" />
              </div>

              <!-- Line -->
              <div
                v-else-if="item.pair"
                class="diff-line"
                :class="{
                  'diff-add': item.pair.right.type === 'add',
                  'diff-empty': item.pair.right.type === 'empty',
                  'diff-context': item.pair.right.type === 'context',
                }"
              >
                <div class="diff-gutter">
                  <span v-if="item.pair.right.lineNum" class="line-number">
                    {{ item.pair.right.lineNum }}
                  </span>
                </div>
                <div class="diff-content">
                  <span
                    v-if="item.pair.right.type !== 'empty'"
                    class="diff-code"
                    v-html="getHighlightedContent(item.pair.id, 'new') || escapeHtml(item.pair.right.content)"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
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
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
}

.diff-split {
  display: flex;
  min-width: 100%;
}

.diff-column {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.diff-column-left {
  border-right: 1px solid hsl(var(--border));
}

.diff-column-content {
  min-width: fit-content;
}

.diff-line {
  display: flex;
}

.diff-gutter {
  flex-shrink: 0;
  width: 3.5rem;
  padding: 0 0.5rem;
  text-align: right;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.3);
  user-select: none;
}

.line-number {
  display: inline-block;
  min-width: 2rem;
  opacity: 0.7;
}

.diff-content {
  flex: 1;
  min-width: 0;
  padding: 0 0.5rem;
  white-space: pre;
  color: hsl(var(--foreground));
}

.diff-code {
  display: inline;
  color: inherit;
}

/* Line type styles */
.diff-add {
  background: hsl(142 76% 36% / 0.15);
}

.diff-add .diff-gutter {
  background: hsl(142 76% 36% / 0.25);
}

.diff-remove {
  background: hsl(0 84% 60% / 0.15);
}

.diff-remove .diff-gutter {
  background: hsl(0 84% 60% / 0.25);
}

.diff-empty {
  background: hsl(var(--muted) / 0.2);
}

.diff-empty .diff-gutter {
  background: hsl(var(--muted) / 0.3);
}

.diff-context {
  background: transparent;
}

/* Full file view */
.full-file-view {
  min-width: 100%;
}

.full-file-line {
  display: flex;
}

.full-file-line .diff-gutter {
  width: 4rem;
}

.full-file-line.diff-add {
  background: hsl(142 76% 36% / 0.15);
}

.full-file-line.diff-add .diff-gutter {
  background: hsl(142 76% 36% / 0.25);
}

.dark .full-file-line.diff-add {
  background: hsl(142 76% 36% / 0.1);
}

.dark .full-file-line.diff-add .diff-gutter {
  background: hsl(142 76% 36% / 0.2);
}

/* Hunk separator */
.diff-separator {
  display: flex;
  align-items: center;
  padding: 0.25rem 0;
  background: hsl(var(--muted) / 0.4);
}

.diff-separator-half {
  display: flex;
  align-items: center;
  padding: 0.25rem 0;
  background: hsl(var(--muted) / 0.4);
}

.separator-line {
  flex: 1;
  height: 1px;
  background: hsl(var(--border));
}

.separator-text {
  padding: 0 0.75rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

/* Dark mode adjustments */
.dark .diff-add {
  background: hsl(142 76% 36% / 0.1);
}

.dark .diff-add .diff-gutter {
  background: hsl(142 76% 36% / 0.2);
}

.dark .diff-remove {
  background: hsl(0 84% 60% / 0.1);
}

.dark .diff-remove .diff-gutter {
  background: hsl(0 84% 60% / 0.2);
}

/* Shiki output styling */
:deep(.shiki),
:deep(.shiki span) {
  background: transparent !important;
}
</style>

<style>
/* Shiki dual-theme switching - must be global to reach html.dark
   We target spans with --shiki-dark variable since we extract only
   the inner content from Shiki's output (without the .shiki wrapper) */
html.dark .diff-viewer span[style*="--shiki-dark"] {
  color: var(--shiki-dark) !important;
  background-color: transparent !important;
}
</style>
