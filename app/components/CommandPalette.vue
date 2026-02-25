<script setup lang="ts">
import { FileText, Monitor, Moon, Sun, Folder, Check, Keyboard, RefreshCw, GitBranch, Archive } from 'lucide-vue-next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '~/components/ui/command'

const open = defineModel<boolean>('open', { default: false })
const filter = defineModel<string>('filter', { default: '' })

const emit = defineEmits<{
  openShortcutsHelp: []
}>()

const router = useRouter()
const { themeMode, cycleThemeMode } = useThemeMode()
const { prds, showArchived, toggleShowArchived } = usePrd()
const { repos, currentRepoId, selectRepo, refreshGitRepos } = useRepos()
const { showSuccess, showError } = useToast()

type PrdViewTab = 'document' | 'board' | 'graph'

const TAB_ORDER: PrdViewTab[] = ['document', 'board', 'graph']
const TAB_LABELS: Record<PrdViewTab, string> = {
  document: 'Document',
  board: 'Task Board',
  graph: 'Graph'
}

// Get current tab from localStorage
const currentTab = ref<PrdViewTab>('document')

if (import.meta.client) {
  const saved = localStorage.getItem('prd-viewer-tab')
  if (saved === 'document' || saved === 'board' || saved === 'graph') {
    currentTab.value = saved
  }
}

function handleStorageEvent(event: StorageEvent) {
  if (event.key !== 'prd-viewer-tab' || !event.newValue) {
    return
  }

  if (event.newValue === 'document' || event.newValue === 'board' || event.newValue === 'graph') {
    currentTab.value = event.newValue
  }
}

onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('storage', handleStorageEvent)
  }
})

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('storage', handleStorageEvent)
  }
})

const nextTab = computed<PrdViewTab>(() => {
  const index = TAB_ORDER.indexOf(currentTab.value)
  const safeIndex = index >= 0 ? index : 0
  return TAB_ORDER[(safeIndex + 1) % TAB_ORDER.length] as PrdViewTab
})

const nextTabLabel = computed(() => TAB_LABELS[nextTab.value])

function navigateToPrd(slug: string) {
  if (!currentRepoId.value) return
  router.push(`/${currentRepoId.value}/${slug}`)
  open.value = false
}

function switchRepo(repoId: string) {
  selectRepo(repoId)
  router.push('/')
  open.value = false
}

function toggleTheme() {
  cycleThemeMode()
  open.value = false
}

function toggleTab() {
  const newTab = nextTab.value
  currentTab.value = newTab
  if (import.meta.client) {
    localStorage.setItem('prd-viewer-tab', newTab)
    // Dispatch a storage event so the page can react
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'prd-viewer-tab',
      newValue: newTab
    }))
  }
  open.value = false
}

function openShortcutsHelp() {
  open.value = false
  emit('openShortcutsHelp')
}

function toggleArchivedVisibility() {
  toggleShowArchived()
  open.value = false
}

const isRefreshingGitRepos = ref(false)

async function handleRefreshGitRepos() {
  if (!currentRepoId.value || isRefreshingGitRepos.value) return

  isRefreshingGitRepos.value = true
  open.value = false

  try {
    const result = await refreshGitRepos(currentRepoId.value)
    showSuccess(`Discovered ${result.discovered} git repositories`)
  } catch {
    showError('Failed to refresh git repos')
  } finally {
    isRefreshingGitRepos.value = false
  }
}

// Clear the filter when dialog closes
watch(open, (isOpen) => {
  if (!isOpen) {
    filter.value = ''
  }
})

// Detect platform for shortcut hints
const isMac = computed(() => {
  if (!import.meta.client) return true
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
})
const modKey = computed(() => isMac.value ? '⌘' : 'Ctrl')
</script>

<template>
  <CommandDialog v-model:open="open" :default-search="filter">
    <CommandInput placeholder="Type a command or search..." />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>

      <CommandGroup v-if="prds?.length" heading="Documents">
        <CommandItem
          v-for="prd in prds"
          :key="prd.slug"
          :value="`PRD: ${prd.name}`"
          @select="navigateToPrd(prd.slug)"
        >
          <FileText class="size-4" />
          <span class="flex items-center gap-1">
            <span>{{ prd.name }}</span>
            <span v-if="prd.archived" class="text-[10px] uppercase tracking-wide text-muted-foreground">Archived</span>
          </span>
        </CommandItem>
      </CommandGroup>

      <CommandSeparator v-if="prds?.length && repos?.length" />

      <CommandGroup v-if="repos?.length" heading="Repositories">
        <CommandItem
          v-for="repo in repos"
          :key="repo.id"
          :value="`repo-${repo.id} ${repo.name}`"
          @select="switchRepo(repo.id)"
        >
          <Folder class="size-4" />
          <span class="flex-1">{{ repo.name }}</span>
          <Check v-if="repo.id === currentRepoId" class="size-4 text-primary" />
        </CommandItem>
      </CommandGroup>

      <CommandSeparator v-if="repos?.length" />

      <CommandGroup heading="Actions">
        <CommandItem value="cycle-theme light dark system" @select="toggleTheme">
          <Monitor v-if="themeMode === 'system'" class="size-4" />
          <Sun v-else-if="themeMode === 'light'" class="size-4" />
          <Moon v-else class="size-4" />
          <span class="flex-1">Cycle theme mode ({{ themeMode }})</span>
          <div class="ml-auto flex items-center gap-1">
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{{ modKey }}</kbd>
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">.</kbd>
          </div>
        </CommandItem>
        <CommandItem
          :value="`switch-tab ${nextTabLabel.toLowerCase()}`"
          @select="toggleTab"
        >
          <GitBranch class="size-4" />
          <span class="flex-1">Switch to {{ nextTabLabel }}</span>
          <div class="ml-auto flex items-center gap-1">
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{{ modKey }}</kbd>
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">\</kbd>
          </div>
        </CommandItem>
        <CommandItem value="keyboard shortcuts help" @select="openShortcutsHelp">
          <Keyboard class="size-4" />
          <span class="flex-1">Keyboard shortcuts</span>
          <div class="ml-auto flex items-center gap-1">
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{{ modKey }}</kbd>
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">/</kbd>
          </div>
        </CommandItem>
        <CommandItem
          v-if="currentRepoId"
          value="refresh git repos rescan discover"
          :disabled="isRefreshingGitRepos"
          @select="handleRefreshGitRepos"
        >
          <RefreshCw class="size-4" :class="{ 'animate-spin': isRefreshingGitRepos }" />
          <span class="flex-1">Refresh git repos</span>
        </CommandItem>
        <CommandItem value="toggle archived documents" @select="toggleArchivedVisibility">
          <Archive class="size-4" />
          <span class="flex-1">{{ showArchived ? 'Hide archived documents' : 'Show archived documents' }}</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
