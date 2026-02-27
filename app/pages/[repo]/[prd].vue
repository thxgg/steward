<script setup lang="ts">
import { FileText, LayoutGrid, AlertCircle, Loader2, RefreshCw, GitBranch } from 'lucide-vue-next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import type { PrdDocument } from '~/types/prd'
import type { GraphPrdPayload } from '~/types/graph'
import type { Task, TasksFile, ProgressFile, CommitRef } from '~/types/task'

type PrdViewTab = 'document' | 'board' | 'graph'
type FetchError = {
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: {
    message?: string
  }
}

const TAB_STORAGE_KEY = 'prd-viewer-tab'
const TASK_QUERY_KEY = 'task'
const TASK_PRD_QUERY_KEY = 'taskPrd'

function isPrdViewTab(value: string): value is PrdViewTab {
  return value === 'document' || value === 'board' || value === 'graph'
}

function getSingleQueryParam(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]
    if (typeof first === 'string') {
      const trimmed = first.trim()
      return trimmed.length > 0 ? trimmed : null
    }
  }

  return null
}

function getStatusCode(error: unknown): number | undefined {
  const fetchError = error as FetchError
  return fetchError.statusCode ?? fetchError.status
}

function getErrorMessage(error: unknown, fallback: string): string {
  const fetchError = error as FetchError
  return fetchError.data?.message || fetchError.statusMessage || fetchError.message || fallback
}

// Disable SSR for this page - requires client-side localStorage for repo context
definePageMeta({
  ssr: false
})

const route = useRoute()
const router = useRouter()
const { selectRepo } = useRepos()
const {
  prds,
  showArchived,
  setPrdArchived,
  fetchDocument,
  fetchTasks,
  fetchProgress,
  fetchTaskCommits,
  fetchPrdGraph
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

// Active tab (persisted in localStorage)
const activeTab = ref<PrdViewTab>('document')

// Graph data state (lazy-loaded)
const prdGraph = ref<GraphPrdPayload | null>(null)
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
const isUpdatingArchive = ref(false)

const taskQueryId = computed(() => getSingleQueryParam(route.query[TASK_QUERY_KEY]))
const taskQueryPrd = computed(() => getSingleQueryParam(route.query[TASK_PRD_QUERY_KEY]))

const routeTaskSelection = computed(() => {
  if (!taskQueryId.value) {
    return null
  }

  return {
    taskId: taskQueryId.value,
    prdSlug: taskQueryPrd.value || prdSlug.value
  }
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

  try {
    const tasks = await fetchTasks(slug)
    cacheTasksForPrd(slug, tasks)
    return tasks
  } catch (error) {
    showError('Failed to load tasks', getErrorMessage(error, `Could not load tasks for ${slug}.`))
    return null
  }
}

function buildBaseQuery(): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}

  for (const [key, value] of Object.entries(route.query)) {
    if (key === TASK_QUERY_KEY || key === TASK_PRD_QUERY_KEY) {
      continue
    }

    if (typeof value === 'string') {
      query[key] = value
      continue
    }

    if (Array.isArray(value)) {
      const values = value.filter((entry): entry is string => typeof entry === 'string')
      if (values.length > 0) {
        query[key] = values
      }
    }
  }

  return query
}

async function syncTaskQuery(taskId: string | null, sourcePrdSlug: string | null = null) {
  const nextQuery = buildBaseQuery()

  if (taskId) {
    nextQuery[TASK_QUERY_KEY] = taskId

    if (sourcePrdSlug && sourcePrdSlug !== prdSlug.value) {
      nextQuery[TASK_PRD_QUERY_KEY] = sourcePrdSlug
    }
  }

  const nextTaskId = typeof nextQuery[TASK_QUERY_KEY] === 'string' ? nextQuery[TASK_QUERY_KEY] : null
  const nextTaskPrd = typeof nextQuery[TASK_PRD_QUERY_KEY] === 'string' ? nextQuery[TASK_PRD_QUERY_KEY] : null

  if (taskQueryId.value === nextTaskId && taskQueryPrd.value === nextTaskPrd) {
    return
  }

  await router.replace({ query: nextQuery })
}

async function openTaskDetail(task: Task, sourcePrdSlug: string) {
  selectedTask.value = task
  selectedTaskPrdSlug.value = sourcePrdSlug
  detailOpen.value = true
  selectedTaskCommits.value = []

  await syncTaskQuery(task.id, sourcePrdSlug)

  try {
    selectedTaskCommits.value = await fetchTaskCommits(sourcePrdSlug, task.id)
  } catch (error) {
    selectedTaskCommits.value = []
    showError('Failed to load commits', getErrorMessage(error, 'Could not resolve commits for this task.'))
  }
}

async function syncTaskDetailFromRoute() {
  const selection = routeTaskSelection.value

  if (!selection) {
    selectedTask.value = null
    selectedTaskPrdSlug.value = null
    selectedTaskCommits.value = []
    detailOpen.value = false
    return
  }

  const sourceTasks = await getTasksForPrd(selection.prdSlug)
  const task = sourceTasks?.tasks.find((entry) => entry.id === selection.taskId)

  if (!task) {
    selectedTask.value = null
    selectedTaskPrdSlug.value = null
    selectedTaskCommits.value = []
    detailOpen.value = false
    showError('Task unavailable', `Could not find ${selection.taskId} in ${selection.prdSlug}.`)
    await syncTaskQuery(null)
    return
  }

  const isSameTask = selectedTask.value?.id === task.id && selectedTaskPrdSlug.value === selection.prdSlug

  selectedTask.value = task
  selectedTaskPrdSlug.value = selection.prdSlug
  detailOpen.value = true

  if (!isSameTask) {
    try {
      selectedTaskCommits.value = await fetchTaskCommits(selection.prdSlug, task.id)
    } catch (error) {
      selectedTaskCommits.value = []
      showError('Failed to load commits', getErrorMessage(error, 'Could not resolve commits for this task.'))
    }
  }
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

// Inject file change event from layout for live updates
const fileChangeEvent = inject<Ref<{ category: string; path?: string; timestamp: number } | null>>('fileChangeEvent', ref(null))

// Load PRD document only
async function loadDocument() {
  try {
    const doc = await fetchDocument(prdSlug.value)
    if (doc) {
      document.value = doc
      error.value = null
    }
  } catch (err) {
    const statusCode = getStatusCode(err)
    if (statusCode === 404) {
      error.value = `PRD "${prdSlug.value}" not found in this repository.`
      return
    }

    showError('Failed to reload PRD', getErrorMessage(err, 'Could not refresh the PRD document.'))
  }
}

// Load tasks and progress only
async function loadTasksAndProgress() {
  try {
    const [tasks, progress] = await Promise.all([
      fetchTasks(prdSlug.value),
      fetchProgress(prdSlug.value)
    ])

    tasksFile.value = tasks
    progressFile.value = progress
    cacheTasksForPrd(prdSlug.value, tasks)
    await syncTaskDetailFromRoute()
  } catch (err) {
    showError('Failed to refresh task state', getErrorMessage(err, 'Could not refresh tasks and progress.'))
  }
}

async function loadGraph(force: boolean = false) {
  graphLoading.value = true

  try {
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
  } catch (err) {
    graphError.value = getErrorMessage(err, 'Failed to load PRD graph.')
  } finally {
    graphLoading.value = false
  }
}

async function ensureGraphLoaded(force: boolean = false) {
  if (activeTab.value !== 'graph') {
    return
  }

  await loadGraph(force)
}

// Fetch all data (initial load and route changes)
async function loadData() {
  isLoading.value = true
  error.value = null
  graphError.value = null

  prdGraph.value = null
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
    await syncTaskDetailFromRoute()
  } catch (err) {
    const statusCode = getStatusCode(err)
    if (statusCode === 404) {
      error.value = `PRD "${prdSlug.value}" not found. Check if the file exists in docs/prd/.`
    } else if (statusCode === 500) {
      error.value = 'Server error while loading the PRD. Check the file format.'
      showError('Server error', getErrorMessage(err, 'Failed to read PRD file'))
    } else {
      error.value = 'Failed to load PRD document. Please try again.'
      showError('Load failed', getErrorMessage(err, 'Could not fetch the PRD document'))
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

watch(
  () => [route.query[TASK_QUERY_KEY], route.query[TASK_PRD_QUERY_KEY], prdSlug.value] as const,
  async () => {
    if (isLoading.value) {
      return
    }

    await syncTaskDetailFromRoute()
  }
)

watch(detailOpen, async (isOpen) => {
  if (!isOpen && routeTaskSelection.value) {
    await syncTaskQuery(null)
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
        await loadGraph(true)
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
      if (isCurrentPrdChange) {
        await loadGraph(true)
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
  await openTaskDetail(task, prdSlug.value)
}

// Handle graph node task click
async function handleGraphTaskClick(payload: { prdSlug: string; taskId: string }) {
  const sourceTasks = await getTasksForPrd(payload.prdSlug)
  const task = sourceTasks?.tasks.find((entry) => entry.id === payload.taskId)

  if (!task) {
    showError('Task unavailable', `Could not find ${payload.taskId} in ${payload.prdSlug}.`)
    return
  }

  await openTaskDetail(task, payload.prdSlug)
}

async function handleArchiveToggle(archived: boolean) {
  if (!document.value || isUpdatingArchive.value) {
    return
  }

  isUpdatingArchive.value = true

  try {
    const archiveState = await setPrdArchived(prdSlug.value, archived)

    if (document.value) {
      document.value = {
        ...document.value,
        archived: archiveState.archived,
        archivedAt: archiveState.archivedAt
      }
    }

    if (archived && !showArchived.value) {
      const nextPrd = prds.value?.find((entry) => entry.slug !== prdSlug.value)

      if (nextPrd) {
        await router.push(`/${repoId.value}/${nextPrd.slug}`)
      } else {
        await router.push('/')
      }
    }
  } catch (err) {
    showError('Failed to update archive state', getErrorMessage(err, 'Could not update this PRD archive state.'))
  } finally {
    isUpdatingArchive.value = false
  }
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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight">{{ document.name }}</h1>
            <Badge
              v-if="document.archived"
              variant="outline"
              class="text-[10px] uppercase tracking-wide"
            >
              Archived
            </Badge>
          </div>
          <PrdMeta :metadata="document.metadata" />
        </div>

        <Button
          variant="outline"
          size="sm"
          :disabled="isUpdatingArchive"
          @click="handleArchiveToggle(!document.archived)"
        >
          <span v-if="isUpdatingArchive">Saving...</span>
          <span v-else>{{ document.archived ? 'Restore document' : 'Archive document' }}</span>
        </Button>
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
        <TabsContent value="graph" class="mt-4">
          <div class="h-[calc(100vh-300px)] min-h-[440px] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-[var(--ease-out-cubic)] motion-reduce:transition-none">
            <GraphExplorer
              :payload="prdGraph"
              scope="prd"
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
