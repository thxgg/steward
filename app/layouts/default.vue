<script setup lang="ts">
import { Button } from '~/components/ui/button'
import CommandPalette from '~/components/CommandPalette.vue'
import ShortcutsHelp from '~/components/ShortcutsHelp.vue'

const colorMode = useColorMode()
const { refreshPrds } = usePrd()
const { currentRepoId } = useRepos()
const route = useRoute()

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
  commandPaletteFilter.value = 'prd-'
  commandPaletteOpen.value = true
})
onShortcut('Ctrl+j', () => {
  commandPaletteFilter.value = 'prd-'
  commandPaletteOpen.value = true
})

// Cmd/Ctrl+Shift+T to toggle Document/Task Board tabs
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
onShortcut('Meta+Shift+t', toggleTab)
onShortcut('Ctrl+Shift+t', toggleTab)

// Cmd/Ctrl+. to toggle theme
function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
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

  // For task/progress changes on current PRD page, trigger a page refresh
  if (event.category === 'tasks' || event.category === 'progress') {
    const prdSlug = route.params.prd as string | undefined
    if (prdSlug && event.path?.includes(`/${prdSlug}/`)) {
      // Refresh the page data by navigating to the same route
      navigateTo(route.fullPath, { replace: true })
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
              <svg
                v-if="colorMode.value === 'dark'"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4"
              >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              <span class="sr-only">Toggle theme</span>
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
