<script setup lang="ts">
import { FileText, LayoutGrid, AlertCircle, Loader2, RefreshCw, GitBranch } from 'lucide-vue-next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import type { PrdDocument } from '~/types/prd'
import type { GraphPrdPayload, GraphRepoPayload } from '~/types/graph'
import type { Task, TasksFile, ProgressFile, CommitRef } from '~/types/task'

type PrdViewTab = 'document' | 'board' | 'graph'
type GraphScope = 'prd' | 'repo'

const TAB_STORAGE_KEY = 'prd-viewer-tab'
const GRAPH_SCOPE_STORAGE_KEY = 'prd-viewer-graph-scope'

function isPrdViewTab(value: string): value is PrdViewTab {
  return value === 'document' || value === 'board' || value === 'graph'
}

function isGraphScope(value: string): value is GraphScope {
  return value === 'prd' || value === 'repo'
}

// Disable SSR for this page - requires client-side localStorage for repo context
definePageMeta({
  ssr: false
})

const route = useRoute()
const { selectRepo } = useRepos()
const {
  fetchDocument,
  fetchTasks,
  fetchProgress,
  fetchTaskCommits,
  fetchPrdGraph,
  fetchRepoGraph
} = usePrd()
const { showError } = useToast()

// Get route params
const repoId = computed(() => route.params.repo as string)
const prdSlug = computed(() => route.params.prd as string)

// State
const document = ref<PrdDocument | null>(null)
const tasksFile = ref<TasksFile | null>(null)
const progressFile = ref<ProgressFile | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

// Active tab and graph scope (persisted in localStorage)
const activeTab = ref<PrdViewTab>('document')
const graphScope = ref<GraphScope>('prd')

// Graph data state (lazy-loaded)
const prdGraph = ref<GraphPrdPayload | null>(null)
const repoGraph = ref<GraphRepoPayload | null>(null)
const graphLoading = ref(false)
const graphError = ref<string | null>(null)

// Cache tasks per PRD so repo graph selections can open details
const tasksByPrd = ref<Record<string, TasksFile | null>>({})

// Selected task for detail view
const selectedTask = ref<Task | null>(null)
const selectedTaskPrdSlug = ref<string | null>(null)
const detailOpen = ref(false)

// Resolved commits for selected task (fetched from API with repo context)
const selectedTaskCommits = ref<CommitRef[]>([])

const activeGraph = computed(() => {
  return graphScope.value === 'prd' ? prdGraph.value : repoGraph.value
})

function cacheTasksForPrd(slug: string, tasks: TasksFile | null) {
  tasksByPrd.value = {
    ...tasksByPrd.value,
    [slug]: tasks
  }
}

async function getTasksForPrd(slug: string): Promise<TasksFile | null> {
  if (slug === prdSlug.value) {
    return tasksFile.value
  }

  if (Object.prototype.hasOwnProperty.call(tasksByPrd.value, slug)) {
    return tasksByPrd.value[slug] ?? null
  }

  const tasks = await fetchTasks(slug)
  cacheTasksForPrd(slug, tasks)
  return tasks
}

// Build task title map for dependency display based on selected task source PRD
const taskTitles = computed(() => {
  const map = new Map<string, string>()
  const sourcePrdSlug = selectedTaskPrdSlug.value || prdSlug.value
  const sourceTasks = sourcePrdSlug === prdSlug.value
    ? tasksFile.value
    : tasksByPrd.value[sourcePrdSlug] ?? null

  if (!sourceTasks?.tasks) {
    return map
  }

  for (const task of sourceTasks.tasks) {
    map.set(task.id, task.title)
  }

  return map
})

function handleStorageEvent(event: StorageEvent) {
  if (event.key === TAB_STORAGE_KEY && event.newValue && isPrdViewTab(event.newValue)) {
    activeTab.value = event.newValue
  }

  if (event.key === GRAPH_SCOPE_STORAGE_KEY && event.newValue && isGraphScope(event.newValue)) {
    graphScope.value = event.newValue
  }
}

// Load persisted preferences
onMounted(() => {
  if (!import.meta.client) {
    return
  }

  const savedTab = localStorage.getItem(TAB_STORAGE_KEY)
  if (savedTab && isPrdViewTab(savedTab)) {
    activeTab.value = savedTab
  }

  const savedGraphScope = localStorage.getItem(GRAPH_SCOPE_STORAGE_KEY)
  if (savedGraphScope && isGraphScope(savedGraphScope)) {
    graphScope.value = savedGraphScope
  }

  window.addEventListener('storage', handleStorageEvent)
})

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('storage', handleStorageEvent)
  }
})

// Save preferences
watch(activeTab, (tab) => {
  if (import.meta.client) {
    localStorage.setItem(TAB_STORAGE_KEY, tab)
  }
})

watch(graphScope, (scope) => {
  if (import.meta.client) {
    localStorage.setItem(GRAPH_SCOPE_STORAGE_KEY, scope)
  }
})

// Inject file change event from layout for live updates
const fileChangeEvent = inject<Ref<{ category: string; path?: string; timestamp: number } | null>>('fileChangeEvent', ref(null))

// Load PRD document only
async function loadDocument() {
  const doc = await fetchDocument(prdSlug.value)
  if (doc) {
    document.value = doc
  }
}

// Load tasks and progress only
async function loadTasksAndProgress() {
  const [tasks, progress] = await Promise.all([
    fetchTasks(prdSlug.value),
    fetchProgress(prdSlug.value)
  ])

  tasksFile.value = tasks
  progressFile.value = progress
  cacheTasksForPrd(prdSlug.value, tasks)
}

async function loadGraph(scope: GraphScope, force: boolean = false) {
  graphLoading.value = true

  try {
    if (scope === 'prd') {
      if (!force && prdGraph.value?.prdSlug === prdSlug.value) {
        return
      }

      const graph = await fetchPrdGraph(prdSlug.value)
      if (!graph) {
        graphError.value = 'Failed to load PRD graph.'
        return
      }

      prdGraph.value = graph
      graphError.value = null
      return
    }

    if (!force && repoGraph.value) {
      return
    }

    const graph = await fetchRepoGraph()
    if (!graph) {
      graphError.value = 'Failed to load repository graph.'
      return
    }

    repoGraph.value = graph
    graphError.value = null
  } finally {
    graphLoading.value = false
  }
}

async function ensureGraphLoaded(force: boolean = false) {
  if (activeTab.value !== 'graph') {
    return
  }

  await loadGraph(graphScope.value, force)
}

// Fetch all data (initial load and route changes)
async function loadData() {
  isLoading.value = true
  error.value = null
  graphError.value = null

  prdGraph.value = null
  repoGraph.value = null
  tasksByPrd.value = {}

  try {
    // Ensure repo is selected
    selectRepo(repoId.value)

    // Fetch document, tasks, and progress in parallel
    const [doc, tasks, progress] = await Promise.all([
      fetchDocument(prdSlug.value),
      fetchTasks(prdSlug.value),
      fetchProgress(prdSlug.value)
    ])

    if (!doc) {
      error.value = `PRD "${prdSlug.value}" not found in this repository.`
      return
    }

    document.value = doc
    tasksFile.value = tasks
    progressFile.value = progress
    cacheTasksForPrd(prdSlug.value, tasks)

    // Auto-switch if board tab selected but no task state exists
    if (!tasks && activeTab.value === 'board') {
      activeTab.value = 'document'
    }

    await ensureGraphLoaded()
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

watch(activeTab, async (tab) => {
  if (tab === 'graph') {
    await ensureGraphLoaded()
  }
})

watch(graphScope, async () => {
  if (activeTab.value === 'graph') {
    await loadGraph(graphScope.value)
  }
})

// Watch for file changes and refresh relevant data
watch(
  () => fileChangeEvent.value,
  async (event) => {
    if (!event) {
      return
    }

    if (event.category === 'prd') {
      await loadDocument()
      if (activeTab.value === 'graph') {
        await loadGraph(graphScope.value, true)
      }
      return
    }

    if (event.category !== 'tasks' && event.category !== 'progress') {
      return
    }

    const isCurrentPrdChange = event.path?.includes(`/${prdSlug.value}/`) ?? false

    if (isCurrentPrdChange) {
      await loadTasksAndProgress()
      prdGraph.value = null
    }

    if (activeTab.value === 'graph') {
      if (graphScope.value === 'repo' || isCurrentPrdChange) {
        await loadGraph(graphScope.value, true)
      }
    }
  }
)

// Load data on mount
onMounted(loadData)

// Reload when route params change
watch([repoId, prdSlug], loadData)

// Handle board task click
async function handleTaskClick(task: Task) {
  selectedTask.value = task
  selectedTaskPrdSlug.value = prdSlug.value
  detailOpen.value = true
  selectedTaskCommits.value = await fetchTaskCommits(prdSlug.value, task.id)
}

// Handle graph node task click
async function handleGraphTaskClick(payload: { prdSlug: string; taskId: string }) {
  const sourceTasks = await getTasksForPrd(payload.prdSlug)
  const task = sourceTasks?.tasks.find((entry) => entry.id === payload.taskId)

  if (!task) {
    showError('Task unavailable', `Could not find ${payload.taskId} in ${payload.prdSlug}.`)
    return
  }

  selectedTask.value = task
  selectedTaskPrdSlug.value = payload.prdSlug
  detailOpen.value = true
  selectedTaskCommits.value = await fetchTaskCommits(payload.prdSlug, task.id)
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
          <TabsTrigger value="graph" class="gap-2">
            <GitBranch class="size-4" />
            Graph
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
              Task state has not been generated for this PRD yet.
            </p>
          </div>
        </TabsContent>

        <!-- Graph Tab -->
        <TabsContent value="graph" class="mt-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <div class="inline-flex rounded-md border border-border bg-muted/40 p-1">
              <Button
                size="sm"
                :variant="graphScope === 'prd' ? 'default' : 'ghost'"
                class="h-7 px-3 text-xs"
                @click="graphScope = 'prd'"
              >
                PRD
              </Button>
              <Button
                size="sm"
                :variant="graphScope === 'repo' ? 'default' : 'ghost'"
                class="h-7 px-3 text-xs"
                @click="graphScope = 'repo'"
              >
                Repo
              </Button>
            </div>

            <p class="text-xs text-muted-foreground">
              {{ graphScope === 'repo' ? 'Showing dependencies across PRDs with state in this repository.' : 'Showing dependencies for the current PRD only.' }}
            </p>
          </div>

          <div class="h-[calc(100vh-300px)] min-h-[440px] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-[var(--ease-out-cubic)] motion-reduce:transition-none">
            <GraphExplorer
              :payload="activeGraph"
              :scope="graphScope"
              :loading="graphLoading"
              :error="graphError"
              @task-click="handleGraphTaskClick"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>

    <!-- Task Detail Sheet -->
    <TasksDetail
      v-model:open="detailOpen"
      :task="selectedTask"
      :task-titles="taskTitles"
      :commits="selectedTaskCommits"
      :repo-id="repoId"
      :task-prd-slug="selectedTaskPrdSlug"
      :current-prd-slug="prdSlug"
    />
  </div>
</template>
