<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import CommandPalette from '~/components/CommandPalette.vue'
import ShortcutsHelp from '~/components/ShortcutsHelp.vue'

const { themeMode, cycleThemeMode } = useThemeMode()
const { refreshPrds } = usePrd()
const { currentRepoId } = useRepos()
const route = useRoute()

// File change event for live updates (provided to child components)
const fileChangeEvent = ref<{ category: string; path?: string; timestamp: number } | null>(null)
provide('fileChangeEvent', fileChangeEvent)

// Command palette state
const commandPaletteOpen = ref(false)
const commandPaletteFilter = ref('')

// Shortcuts help modal state
const shortcutsHelpOpen = ref(false)

// Ref to access RepoSelector methods
const repoSelectorRef = ref<{ openAddDialog: () => void } | null>(null)

// Register keyboard shortcuts
const { onShortcut } = useKeyboard()

// Cmd/Ctrl+K to open command palette
onShortcut('Meta+k', () => {
  commandPaletteOpen.value = true
})
onShortcut('Ctrl+k', () => {
  commandPaletteOpen.value = true
})

// Cmd/Ctrl+J to open palette pre-filtered to PRDs
onShortcut('Meta+j', () => {
  commandPaletteFilter.value = 'PRD: '
  commandPaletteOpen.value = true
})
onShortcut('Ctrl+j', () => {
  commandPaletteFilter.value = 'PRD: '
  commandPaletteOpen.value = true
})

// Cmd/Ctrl+\ to toggle Document/Task Board tabs
function toggleTab() {
  if (!import.meta.client) return
  const currentTab = localStorage.getItem('prd-viewer-tab') || 'document'
  const newTab = currentTab === 'document' ? 'board' : 'document'
  localStorage.setItem('prd-viewer-tab', newTab)
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'prd-viewer-tab',
    newValue: newTab
  }))
}
onShortcut('Meta+\\', toggleTab)
onShortcut('Ctrl+\\', toggleTab)

// Cmd/Ctrl+. to cycle theme mode (light/dark/system)
function toggleColorMode() {
  cycleThemeMode()
}
onShortcut('Meta+.', toggleColorMode)
onShortcut('Ctrl+.', toggleColorMode)

// Cmd/Ctrl+, to open add repository dialog
function openAddRepoDialog() {
  repoSelectorRef.value?.openAddDialog()
}
onShortcut('Meta+,', openAddRepoDialog)
onShortcut('Ctrl+,', openAddRepoDialog)

// Cmd/Ctrl+/ or Cmd/Ctrl+? to open shortcuts help
function openShortcutsHelp() {
  shortcutsHelpOpen.value = true
}
onShortcut('Meta+/', openShortcutsHelp)
onShortcut('Ctrl+/', openShortcutsHelp)
onShortcut('Meta+Shift+/', openShortcutsHelp) // Cmd+? is Cmd+Shift+/
onShortcut('Ctrl+Shift+/', openShortcutsHelp) // Ctrl+? is Ctrl+Shift+/

// File watching for auto-refresh
useFileWatch((event) => {
  if (event.type === 'connected') {
    return
  }

  // Only refresh if the change is for the current repo
  if (event.repoId !== currentRepoId.value) {
    return
  }

  // Refresh PRD list for any changes
  if (event.category === 'prd' || event.category === 'tasks') {
    refreshPrds()
  }

  // For task/progress/prd changes on current PRD page, emit event for granular refresh
  const prdSlug = route.params.prd as string | undefined
  if (prdSlug) {
    const isPrdChange = event.category === 'prd' && event.path?.includes(`/${prdSlug}.`)
    const isTaskChange = (event.category === 'tasks' || event.category === 'progress') && event.path?.includes(`/${prdSlug}/`)

    if (isPrdChange || isTaskChange) {
      fileChangeEvent.value = {
        category: event.category,
        path: event.path,
        timestamp: Date.now()
      }
    }
  }
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Command Palette -->
    <CommandPalette
      v-model:open="commandPaletteOpen"
      v-model:filter="commandPaletteFilter"
      @open-shortcuts-help="openShortcutsHelp"
    />

    <!-- Shortcuts Help Modal -->
    <ShortcutsHelp v-model:open="shortcutsHelpOpen" />
    <!-- Fixed Header -->
    <header
      class="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
    >
      <div class="flex h-full items-center justify-between px-4 md:px-6">
        <!-- App Title -->
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold tracking-tight">
            PRD Viewer
          </h1>
        </div>

        <!-- Right side: Repo Selector + Theme Toggle (ClientOnly to prevent hydration mismatch) -->
        <ClientOnly>
          <div class="flex items-center gap-3">
            <LayoutRepoSelector ref="repoSelectorRef" />
            <Button
              variant="ghost"
              size="icon"
              class="size-9"
              @click="toggleColorMode"
            >
              <Monitor v-if="themeMode === 'system'" class="size-4" />
              <Sun v-else-if="themeMode === 'light'" class="size-4" />
              <Moon v-else class="size-4" />
              <span class="sr-only">Cycle theme mode</span>
            </Button>
          </div>
          <template #fallback>
            <div class="flex items-center gap-3">
              <div class="h-8 w-[200px] animate-pulse rounded-md bg-muted" />
              <div class="size-9 animate-pulse rounded-md bg-muted" />
            </div>
          </template>
        </ClientOnly>
      </div>
    </header>

    <!-- Main Content Area with top padding for fixed header -->
    <div class="flex h-screen pt-14">
      <!-- Sidebar -->
      <ClientOnly>
        <LayoutSidebar />
        <template #fallback>
          <aside class="flex h-full w-64 flex-col border-r border-border bg-background">
            <div class="flex h-12 items-center border-b border-border px-4">
              <div class="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div class="flex-1 p-2 space-y-2">
              <div class="h-9 animate-pulse rounded-md bg-muted" />
              <div class="h-9 animate-pulse rounded-md bg-muted" />
              <div class="h-9 animate-pulse rounded-md bg-muted" />
            </div>
          </aside>
        </template>
      </ClientOnly>

      <!-- Main content -->
      <main class="flex-1 overflow-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
