<script setup lang="ts">
import { FileText, LayoutGrid, AlertCircle, Loader2, RefreshCw } from 'lucide-vue-next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import type { PrdDocument } from '~/types/prd'
import type { Task, TasksFile } from '~/types/task'

// Disable SSR for this page - requires client-side localStorage for repo context
definePageMeta({
  ssr: false
})

const route = useRoute()
const { selectRepo } = useRepos()
const { fetchDocument, fetchTasks } = usePrd()
const { showError } = useToast()

// Get route params
const repoId = computed(() => route.params.repo as string)
const prdSlug = computed(() => route.params.prd as string)

// State
const document = ref<PrdDocument | null>(null)
const tasksFile = ref<TasksFile | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

// Active tab (persisted in localStorage)
const activeTab = ref('document')

// Load tab preference from localStorage
onMounted(() => {
  if (import.meta.client) {
    const saved = localStorage.getItem('prd-viewer-tab')
    if (saved === 'document' || saved === 'board') {
      activeTab.value = saved
    }
  }
})

// Save tab preference
watch(activeTab, (tab) => {
  if (import.meta.client) {
    localStorage.setItem('prd-viewer-tab', tab)
  }
})

// Selected task for detail view
const selectedTask = ref<Task | null>(null)
const detailOpen = ref(false)

// Build task title map for dependencies display
const taskTitles = computed(() => {
  const map = new Map<string, string>()
  if (tasksFile.value?.tasks) {
    for (const task of tasksFile.value.tasks) {
      map.set(task.id, task.title)
    }
  }
  return map
})

// Fetch data on mount and when params change
async function loadData() {
  isLoading.value = true
  error.value = null

  try {
    // Ensure repo is selected
    selectRepo(repoId.value)

    // Fetch document and tasks in parallel
    const [doc, tasks] = await Promise.all([
      fetchDocument(prdSlug.value),
      fetchTasks(prdSlug.value)
    ])

    if (!doc) {
      error.value = `PRD "${prdSlug.value}" not found in this repository.`
      return
    }

    document.value = doc
    tasksFile.value = tasks
  } catch (err) {
    const fetchErr = err as { statusCode?: number; data?: { message?: string } }
    if (fetchErr.statusCode === 404) {
      error.value = `PRD "${prdSlug.value}" not found. Check if the file exists in docs/prd/.`
    } else if (fetchErr.statusCode === 500) {
      error.value = 'Server error while loading the PRD. Check the file format.'
      showError('Server error', fetchErr.data?.message || 'Failed to read PRD file')
    } else {
      error.value = 'Failed to load PRD document. Please try again.'
      showError('Load failed', 'Could not fetch the PRD document')
    }
  } finally {
    isLoading.value = false
  }
}

// Load data on mount
onMounted(loadData)

// Reload when route params change
watch([repoId, prdSlug], loadData)

// Handle task click
function handleTaskClick(task: Task) {
  selectedTask.value = task
  detailOpen.value = true
}
</script>

<template>
  <div class="h-full p-4 md:p-6">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex h-full items-center justify-center">
      <div class="flex flex-col items-center gap-4">
        <Loader2 class="size-8 animate-spin text-primary" />
        <p class="text-sm text-muted-foreground">Loading PRD...</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex h-full items-center justify-center">
      <div class="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertCircle class="size-12 text-destructive" />
        <h2 class="text-lg font-semibold">Error Loading PRD</h2>
        <p class="text-sm text-muted-foreground">{{ error }}</p>
        <div class="flex gap-3">
          <Button variant="outline" size="sm" @click="loadData">
            <RefreshCw class="mr-2 size-4" />
            Retry
          </Button>
          <NuxtLink to="/">
            <Button variant="ghost" size="sm">
              Go back home
            </Button>
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="document" class="mx-auto max-w-6xl space-y-6">
      <!-- Header with PRD name -->
      <div class="space-y-2">
        <h1 class="text-2xl font-bold tracking-tight">{{ document.name }}</h1>
        <PrdMeta :metadata="document.metadata" />
      </div>

      <!-- Tabs -->
      <Tabs v-model="activeTab" class="w-full">
        <TabsList>
          <TabsTrigger value="document" class="gap-2">
            <FileText class="size-4" />
            Document
          </TabsTrigger>
          <TabsTrigger value="board" class="gap-2" :disabled="!tasksFile">
            <LayoutGrid class="size-4" />
            Task Board
            <span v-if="tasksFile" class="text-xs text-muted-foreground">
              ({{ tasksFile.tasks.length }})
            </span>
          </TabsTrigger>
        </TabsList>

        <!-- Document Tab -->
        <TabsContent value="document" class="mt-4">
          <div class="rounded-lg border border-border bg-card p-4 md:p-6">
            <PrdViewer :content="document.content" />
          </div>
        </TabsContent>

        <!-- Board Tab -->
        <TabsContent value="board" class="mt-4">
          <div v-if="tasksFile" class="h-[calc(100vh-280px)] min-h-[400px]">
            <TasksBoard
              :tasks="tasksFile.tasks"
              @task-click="handleTaskClick"
            />
          </div>
          <div v-else class="py-12 text-center">
            <LayoutGrid class="mx-auto size-12 text-muted-foreground/50" />
            <p class="mt-4 text-muted-foreground">
              No tasks found for this PRD
            </p>
            <p class="mt-1 text-sm text-muted-foreground/70">
              Tasks are loaded from .claude/state/{{ prdSlug }}/tasks.json
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>

    <!-- Task Detail Sheet -->
    <TasksDetail
      v-model:open="detailOpen"
      :task="selectedTask"
      :task-titles="taskTitles"
    />
  </div>
</template>
