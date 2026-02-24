<script setup lang="ts">
import { GitBranch, RefreshCw } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import type { GraphRepoPayload } from '~/types/graph'
import type { Task, TasksFile, CommitRef } from '~/types/task'

definePageMeta({
  ssr: false
})

const route = useRoute()
const { selectRepo } = useRepos()
const { fetchRepoGraph, fetchTasks, fetchTaskCommits } = usePrd()
const { showError } = useToast()

const repoId = computed(() => route.params.repo as string)

const graph = ref<GraphRepoPayload | null>(null)
const graphLoading = ref(false)
const graphError = ref<string | null>(null)

const tasksByPrd = ref<Record<string, TasksFile | null>>({})

const selectedTask = ref<Task | null>(null)
const selectedTaskPrdSlug = ref<string | null>(null)
const detailOpen = ref(false)
const selectedTaskCommits = ref<CommitRef[]>([])

function getErrorMessage(error: unknown, fallback: string): string {
  const fetchError = error as { data?: { message?: string }; statusMessage?: string; message?: string }
  return fetchError.data?.message || fetchError.statusMessage || fetchError.message || fallback
}

function cacheTasksForPrd(slug: string, tasks: TasksFile | null) {
  tasksByPrd.value = {
    ...tasksByPrd.value,
    [slug]: tasks
  }
}

async function getTasksForPrd(slug: string): Promise<TasksFile | null> {
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

const taskTitles = computed(() => {
  const map = new Map<string, string>()
  const sourcePrdSlug = selectedTaskPrdSlug.value

  if (!sourcePrdSlug) {
    return map
  }

  const sourceTasks = tasksByPrd.value[sourcePrdSlug] ?? null
  if (!sourceTasks?.tasks) {
    return map
  }

  for (const task of sourceTasks.tasks) {
    map.set(task.id, task.title)
  }

  return map
})

async function loadGraph(force: boolean = false) {
  if (!repoId.value) {
    return
  }

  if (!force && graph.value) {
    return
  }

  graphLoading.value = true
  graphError.value = null

  try {
    selectRepo(repoId.value)
    const payload = await fetchRepoGraph()

    if (!payload) {
      graphError.value = 'Failed to load repository graph.'
      return
    }

    graph.value = payload
  } catch (error) {
    graphError.value = getErrorMessage(error, 'Failed to load repository graph.')
  } finally {
    graphLoading.value = false
  }
}

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
  selectedTaskCommits.value = []

  try {
    selectedTaskCommits.value = await fetchTaskCommits(payload.prdSlug, task.id)
  } catch (error) {
    showError('Failed to load commits', getErrorMessage(error, 'Could not resolve task commits.'))
  }
}

const fileChangeEvent = inject<Ref<{ category: string; path?: string; timestamp: number } | null>>('fileChangeEvent', ref(null))

watch(
  () => fileChangeEvent.value,
  async (event) => {
    if (!event) {
      return
    }

    if (event.category !== 'tasks' && event.category !== 'progress' && event.category !== 'prd') {
      return
    }

    if (event.category === 'tasks' || event.category === 'progress') {
      tasksByPrd.value = {}
    }

    await loadGraph(true)
  }
)

onMounted(async () => {
  if (!repoId.value) {
    return
  }

  selectRepo(repoId.value)
  await loadGraph(true)
})

watch(repoId, async () => {
  graph.value = null
  graphError.value = null
  tasksByPrd.value = {}

  if (!repoId.value) {
    return
  }

  selectRepo(repoId.value)
  await loadGraph(true)
})
</script>

<template>
  <div class="h-full p-4 md:p-6">
    <div class="mx-auto max-w-[1500px] space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <GitBranch class="size-5" />
            Repository Graph
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Dependency graph across PRDs with task state in this repository.
          </p>
        </div>

        <Button variant="outline" size="sm" class="h-8" @click="loadGraph(true)">
          <RefreshCw class="mr-1.5 size-3.5" :class="{ 'animate-spin': graphLoading }" />
          Refresh
        </Button>
      </div>

      <div class="h-[calc(100vh-220px)] min-h-[500px] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-[var(--ease-out-cubic)] motion-reduce:transition-none">
        <GraphExplorer
          :payload="graph"
          scope="repo"
          :loading="graphLoading"
          :error="graphError"
          @task-click="handleGraphTaskClick"
        />
      </div>
    </div>

    <TasksDetail
      v-model:open="detailOpen"
      :task="selectedTask"
      :task-titles="taskTitles"
      :commits="selectedTaskCommits"
      :repo-id="repoId"
      :task-prd-slug="selectedTaskPrdSlug"
      :current-prd-slug="null"
    />
  </div>
</template>
