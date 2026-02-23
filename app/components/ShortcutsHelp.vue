<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '~/components/ui/dialog'

const open = defineModel<boolean>('open', { default: false })

// Detect if user is on Mac
const isMac = computed(() => {
  if (!import.meta.client) return true // Default to Mac for SSR
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
})

// Modifier key display
const modKey = computed(() => isMac.value ? '⌘' : 'Ctrl')

// Shortcut groups
const shortcutGroups = computed(() => [
  {
    name: 'Navigation',
    shortcuts: [
      { keys: [modKey.value, 'K'], description: 'Open command palette' },
      { keys: [modKey.value, 'J'], description: 'Quick jump to document' }
    ]
  },
  {
    name: 'Actions',
    shortcuts: [
      { keys: [modKey.value, '.'], description: 'Cycle theme mode (light/dark/system)' },
      { keys: [modKey.value, '\\'], description: 'Cycle Document, Task Board, and Graph tabs' },
      { keys: [modKey.value, ','], description: 'Add repository' }
    ]
  },
  {
    name: 'Help',
    shortcuts: [
      { keys: [modKey.value, '/'], description: 'Show this help' },
      { keys: ['Esc'], description: 'Close dialog or palette' }
    ]
  }
])
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <DialogDescription>
          Quick reference for available keyboard shortcuts.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6">
        <div v-for="group in shortcutGroups" :key="group.name">
          <h3 class="mb-3 text-sm font-medium text-muted-foreground">
            {{ group.name }}
          </h3>
          <div class="space-y-2">
            <div
              v-for="shortcut in group.shortcuts"
              :key="shortcut.description"
              class="flex items-center justify-between"
            >
              <span class="text-sm">{{ shortcut.description }}</span>
              <div class="flex items-center gap-1">
                <kbd
                  v-for="(key, index) in shortcut.keys"
                  :key="index"
                  class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground"
                >
                  {{ key }}
                </kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
