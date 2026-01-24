<script setup lang="ts">
import { marked } from 'marked'
import { codeToHtml } from 'shiki'

const props = defineProps<{
  content: string
}>()

const renderedHtml = ref('')
const isLoading = ref(true)

// Configure marked to open links in new tab
const renderer = new marked.Renderer()
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : ''
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

// Custom code block renderer with shiki
const highlightedCodeBlocks = new Map<string, string>()

async function highlightCode(code: string, lang: string): Promise<string> {
  try {
    return await codeToHtml(code, {
      lang: lang || 'text',
      themes: {
        light: 'github-light',
        dark: 'github-dark'
      }
    })
  } catch {
    // Fallback for unsupported languages
    return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`
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

// Extract code blocks and process them
async function renderMarkdown(content: string): Promise<string> {
  // First pass: extract code blocks and replace with placeholders
  // Use format that won't be interpreted as markdown formatting
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  const placeholders: { placeholder: string; lang: string; code: string }[] = []
  let placeholderIndex = 0

  const contentWithPlaceholders = content.replace(codeBlockRegex, (_, lang, code) => {
    const placeholder = `CODEBLOCK${placeholderIndex++}PLACEHOLDER`
    placeholders.push({ placeholder, lang: lang || 'text', code: code.trim() })
    return placeholder
  })

  // Parse markdown without code blocks
  marked.setOptions({
    renderer,
    gfm: true,
    breaks: false
  })

  let html = await marked.parse(contentWithPlaceholders)

  // Highlight code blocks in parallel
  const highlightPromises = placeholders.map(async ({ placeholder, lang, code }) => {
    const highlighted = await highlightCode(code, lang)
    return { placeholder, highlighted }
  })

  const results = await Promise.all(highlightPromises)

  // Replace placeholders with highlighted code
  for (const { placeholder, highlighted } of results) {
    html = html.replace(`<p>${placeholder}</p>`, highlighted)
    html = html.replace(placeholder, highlighted)
  }

  return html
}

// Render on mount and when content changes
watch(() => props.content, async (newContent) => {
  if (newContent) {
    isLoading.value = true
    try {
      renderedHtml.value = await renderMarkdown(newContent)
    } finally {
      isLoading.value = false
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="prd-viewer">
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
    <div
      v-else
      class="prose prose-sm dark:prose-invert max-w-none"
      v-html="renderedHtml"
    />
  </div>
</template>

<style>
/* Prose styling for markdown content */
.prd-viewer .prose {
  --tw-prose-body: hsl(var(--foreground));
  --tw-prose-headings: hsl(var(--foreground));
  --tw-prose-links: hsl(var(--primary));
  --tw-prose-code: hsl(var(--foreground));
  --tw-prose-pre-bg: hsl(var(--muted));
  --tw-prose-quotes: hsl(var(--muted-foreground));
  --tw-prose-hr: hsl(var(--border));
}

.prd-viewer .prose h1,
.prd-viewer .prose h2,
.prd-viewer .prose h3,
.prd-viewer .prose h4 {
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.prd-viewer .prose h1 {
  font-size: 1.875rem;
  border-bottom: 1px solid hsl(var(--border));
  padding-bottom: 0.5rem;
}

.prd-viewer .prose h2 {
  font-size: 1.5rem;
  border-bottom: 1px solid hsl(var(--border));
  padding-bottom: 0.25rem;
}

.prd-viewer .prose h3 {
  font-size: 1.25rem;
}

.prd-viewer .prose p {
  margin-top: 0.75em;
  margin-bottom: 0.75em;
  line-height: 1.7;
}

.prd-viewer .prose a {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.prd-viewer .prose a:hover {
  opacity: 0.8;
}

.prd-viewer .prose code:not(pre code) {
  background: hsl(var(--muted));
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
  font-weight: 500;
}

.prd-viewer .prose pre {
  background: hsl(var(--muted));
  border-radius: 0.5rem;
  padding: 1rem;
  overflow-x: auto;
  margin: 1rem 0;
}

/* Shiki code blocks */
.prd-viewer .prose pre.shiki {
  background-color: hsl(var(--muted)) !important;
}

.prd-viewer .prose .shiki code {
  background: transparent;
  padding: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* Dark mode shiki */
.dark .prd-viewer .prose pre.shiki,
.dark .prd-viewer .prose .shiki {
  background-color: hsl(var(--muted)) !important;
}

.dark .prd-viewer .prose .shiki.github-light {
  display: none !important;
}

.light .prd-viewer .prose .shiki.github-dark,
:not(.dark) .prd-viewer .prose .shiki.github-dark {
  display: none !important;
}

/* Tables */
.prd-viewer .prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.prd-viewer .prose th,
.prd-viewer .prose td {
  border: 1px solid hsl(var(--border));
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.prd-viewer .prose th {
  background: hsl(var(--muted));
  font-weight: 600;
}

.prd-viewer .prose tr:nth-child(even) {
  background: hsl(var(--muted) / 0.3);
}

/* Lists */
.prd-viewer .prose ul,
.prd-viewer .prose ol {
  padding-left: 1.5rem;
  margin: 0.75em 0;
}

.prd-viewer .prose li {
  margin: 0.25em 0;
}

.prd-viewer .prose ul {
  list-style-type: disc;
}

.prd-viewer .prose ol {
  list-style-type: decimal;
}

/* Checkboxes (task lists) */
.prd-viewer .prose input[type="checkbox"] {
  margin-right: 0.5rem;
  pointer-events: none;
}

/* Blockquotes */
.prd-viewer .prose blockquote {
  border-left: 4px solid hsl(var(--border));
  padding-left: 1rem;
  margin: 1rem 0;
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

/* Horizontal rules */
.prd-viewer .prose hr {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 2rem 0;
}

/* Images */
.prd-viewer .prose img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 1rem 0;
}
</style>
