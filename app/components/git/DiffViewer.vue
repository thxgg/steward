<script setup lang="ts">
import { codeToHtml } from 'shiki'
import { Link, Link2Off } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { DiffHunk, DiffLine } from '~/types/git'

const props = defineProps<{
  /** Diff hunks to display */
  hunks: DiffHunk[]
  /** File path for syntax detection */
  filePath: string
}>()

// Synchronized scrolling state
// Note: The side-by-side layout uses a single row container, so scrolling
// is naturally synchronized. This toggle is for UX clarity and future flexibility.
const syncScrollEnabled = ref(true)

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

const language = computed(() => detectLanguage(props.filePath))

// Highlighted lines state
const highlightedLines = ref<Map<string, { old: string; new: string }>>(new Map())
const isLoading = ref(true)

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

// Highlight code with shiki
async function highlightLine(content: string, lang: string): Promise<{ light: string; dark: string }> {
  if (!content.trim()) {
    return { light: '', dark: '' }
  }

  try {
    const html = await codeToHtml(content, {
      lang,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    })
    // Extract just the code content from shiki output
    // Shiki wraps in <pre><code>...</code></pre>
    const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/)
    const code = codeMatch ? codeMatch[1] : content
    return { light: code || '', dark: code || '' }
  } catch {
    return { light: escapeHtml(content), dark: escapeHtml(content) }
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

// Highlight all lines on mount and when hunks change
watch(
  () => [props.hunks, props.filePath] as const,
  async () => {
    isLoading.value = true
    const lang = language.value
    const newHighlighted = new Map<string, { old: string; new: string }>()

    // Collect all unique lines to highlight
    const linesToHighlight: { key: string; content: string; side: 'old' | 'new' }[] = []

    for (const item of displayItems.value) {
      if (item.type === 'line' && item.pair) {
        if (item.pair.left.content && item.pair.left.type !== 'empty') {
          linesToHighlight.push({
            key: `${item.pair.id}-old`,
            content: item.pair.left.content,
            side: 'old',
          })
        }
        if (item.pair.right.content && item.pair.right.type !== 'empty') {
          linesToHighlight.push({
            key: `${item.pair.id}-new`,
            content: item.pair.right.content,
            side: 'new',
          })
        }
      }
    }

    // Highlight in parallel (batch to avoid overwhelming)
    const batchSize = 50
    for (let i = 0; i < linesToHighlight.length; i += batchSize) {
      const batch = linesToHighlight.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(async ({ key, content }) => {
          const result = await highlightLine(content, lang)
          return { key, result }
        })
      )

      for (const { key, result } of results) {
        newHighlighted.set(key, { old: result.light, new: result.dark })
      }
    }

    highlightedLines.value = newHighlighted
    isLoading.value = false
  },
  { immediate: true }
)

// Get highlighted content for a line
function getHighlightedContent(pairId: string, side: 'old' | 'new'): string {
  const highlighted = highlightedLines.value.get(`${pairId}-${side}`)
  return highlighted?.old || ''
}
</script>

<template>
  <div class="diff-viewer">
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>

    <div v-else-if="hunks.length === 0" class="py-8 text-center text-sm text-muted-foreground">
      No changes in this file
    </div>

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
      <!-- Side-by-side view -->
      <div class="diff-table">
        <template v-for="item in displayItems" :key="item.type === 'line' ? item.pair?.id : `sep-${item.hunkIndex}`">
          <!-- Hunk separator -->
          <div v-if="item.type === 'separator'" class="diff-separator">
            <div class="separator-line" />
            <span class="separator-text">···</span>
            <div class="separator-line" />
          </div>

          <!-- Line pair -->
          <div v-else-if="item.pair" class="diff-row">
            <!-- Left side (old) -->
            <div
              class="diff-side diff-left"
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

            <!-- Right side (new) -->
            <div
              class="diff-side diff-right"
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
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
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

.diff-table {
  min-width: 100%;
}

.diff-row {
  display: flex;
}

.diff-side {
  display: flex;
  flex: 1;
  min-width: 0;
}

.diff-left {
  border-right: 1px solid hsl(var(--border));
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
  overflow-x: auto;
}

.diff-code {
  display: inline;
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

/* Hunk separator */
.diff-separator {
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

/* Shiki theme switching */
:deep(.shiki) {
  background: transparent !important;
}

.dark :deep(.shiki.github-light) {
  display: none !important;
}

:not(.dark) :deep(.shiki.github-dark) {
  display: none !important;
}
</style>
