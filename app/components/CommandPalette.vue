<script setup lang="ts">
import { FileText, Moon, Sun, LayoutGrid, Folder, Check, Keyboard, RefreshCw } from 'lucide-vue-next'
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
const colorMode = useColorMode()
const { prds } = usePrd()
const { repos, currentRepoId, selectRepo, refreshGitRepos } = useRepos()
const { showSuccess, showError } = useToast()

// Get current tab from localStorage
const currentTab = ref<'document' | 'board'>('document')

if (import.meta.client) {
  const saved = localStorage.getItem('prd-viewer-tab')
  if (saved === 'document' || saved === 'board') {
    currentTab.value = saved
  }
}

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
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  open.value = false
}

function toggleTab() {
  const newTab = currentTab.value === 'document' ? 'board' : 'document'
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
          <span>{{ prd.name }}</span>
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
        <CommandItem value="toggle-theme light dark" @select="toggleTheme">
          <Sun class="size-4 dark:hidden" />
          <Moon class="hidden size-4 dark:block" />
          <span class="flex-1">Toggle theme</span>
          <div class="ml-auto flex items-center gap-1">
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{{ modKey }}</kbd>
            <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">.</kbd>
          </div>
        </CommandItem>
        <CommandItem
          :value="`switch-tab ${currentTab === 'document' ? 'task board' : 'document'}`"
          @select="toggleTab"
        >
          <LayoutGrid class="size-4" />
          <span class="flex-1">Switch to {{ currentTab === 'document' ? 'Task Board' : 'Document' }}</span>
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
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
