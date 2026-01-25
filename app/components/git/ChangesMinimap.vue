<script setup lang="ts">
import { FilePlus, FileEdit, FileX, ArrowRight } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import type { FileDiff, FileStatus } from '~/types/git'

const props = defineProps<{
  /** Array of file diffs to display */
  files: FileDiff[]
  /** Currently selected file path */
  selectedFile?: string
}>()

const emit = defineEmits<{
  select: [path: string]
}>()

// Calculate max changes for proportional bar sizing
const maxChanges = computed(() => {
  if (props.files.length === 0) return 1
  return Math.max(...props.files.map(f => f.additions + f.deletions), 1)
})

// Get status icon and color
function getStatusConfig(status: FileStatus) {
  switch (status) {
    case 'added':
      return { icon: FilePlus, class: 'text-green-600 dark:text-green-400' }
    case 'deleted':
      return { icon: FileX, class: 'text-red-600 dark:text-red-400' }
    case 'renamed':
      return { icon: ArrowRight, class: 'text-blue-600 dark:text-blue-400' }
    case 'modified':
    default:
      return { icon: FileEdit, class: 'text-yellow-600 dark:text-yellow-400' }
  }
}

// Calculate bar width percentages
function getBarWidths(file: FileDiff) {
  const total = file.additions + file.deletions
  if (total === 0) return { additions: 0, deletions: 0, total: 0 }

  const totalWidth = (total / maxChanges.value) * 100
  const additionsWidth = (file.additions / total) * totalWidth
  const deletionsWidth = (file.deletions / total) * totalWidth

  return {
    additions: additionsWidth,
    deletions: deletionsWidth,
    total: totalWidth,
  }
}

// Get display name for file (handle renames)
function getDisplayName(file: FileDiff): string {
  if (file.status === 'renamed' && file.oldPath) {
    return `${file.oldPath} → ${file.path}`
  }
  return file.path
}

// Get short name (just filename)
function getShortName(path: string): string {
  return path.split('/').pop() || path
}

function handleClick(path: string) {
  emit('select', path)
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="space-y-0.5 p-2">
      <button
        v-for="file in files"
        :key="file.path"
        class="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
        :class="{
          'bg-muted': selectedFile === file.path,
        }"
        @click="handleClick(file.path)"
      >
        <!-- Status icon -->
        <component
          :is="getStatusConfig(file.status).icon"
          class="size-4 shrink-0"
          :class="getStatusConfig(file.status).class"
        />

        <!-- File info -->
        <div class="min-w-0 flex-1">
          <!-- File path -->
          <div
            class="truncate text-xs"
            :class="{
              'font-medium': selectedFile === file.path,
            }"
            :title="getDisplayName(file)"
          >
            <template v-if="file.status === 'renamed' && file.oldPath">
              <span class="text-muted-foreground">{{ getShortName(file.oldPath) }}</span>
              <ArrowRight class="mx-1 inline size-3 text-muted-foreground" />
              <span>{{ getShortName(file.path) }}</span>
            </template>
            <template v-else>
              {{ file.path }}
            </template>
          </div>

          <!-- Change bar -->
          <div class="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              v-if="getBarWidths(file).additions > 0"
              class="bg-green-500 dark:bg-green-400"
              :style="{ width: `${getBarWidths(file).additions}%` }"
            />
            <div
              v-if="getBarWidths(file).deletions > 0"
              class="bg-red-500 dark:bg-red-400"
              :style="{ width: `${getBarWidths(file).deletions}%` }"
            />
          </div>
        </div>

        <!-- Stats -->
        <div class="flex shrink-0 items-center gap-1 text-xs">
          <span v-if="file.additions > 0" class="text-green-600 dark:text-green-400">
            +{{ file.additions }}
          </span>
          <span v-if="file.deletions > 0" class="text-red-600 dark:text-red-400">
            -{{ file.deletions }}
          </span>
        </div>
      </button>

      <!-- Empty state -->
      <div
        v-if="files.length === 0"
        class="py-4 text-center text-sm text-muted-foreground"
      >
        No files changed
      </div>
    </div>
  </ScrollArea>
</template>
