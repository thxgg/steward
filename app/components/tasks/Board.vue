<script setup lang="ts">
import type { Task, TaskStatus } from '~/types/task'

const props = defineProps<{
  tasks: Task[]
}>()

const emit = defineEmits<{
  taskClick: [task: Task]
}>()

// Extract task number from ID (e.g., "task-001" -> 1)
function getTaskNumber(task: Task): number {
  const match = task.id.match(/(\d+)$/)
  const value = match?.[1]
  return value ? parseInt(value, 10) : 0
}

// Group tasks by status and sort them
// Pending/In Progress: lowest number first (ascending)
// Completed: highest number first (descending)
const pendingTasks = computed(() =>
  props.tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => getTaskNumber(a) - getTaskNumber(b))
)

const inProgressTasks = computed(() =>
  props.tasks
    .filter(t => t.status === 'in_progress')
    .sort((a, b) => getTaskNumber(a) - getTaskNumber(b))
)

const completedTasks = computed(() =>
  props.tasks
    .filter(t => t.status === 'completed')
    .sort((a, b) => {
      // Sort by completedAt descending (most recently completed first)
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return bTime - aTime
    })
)

// Build a map of task ID -> array of incomplete blocking task IDs
const blockedByMap = computed(() => {
  const map = new Map<string, string[]>()
  const completedIds = new Set(completedTasks.value.map(t => t.id))

  for (const task of props.tasks) {
    if (task.dependencies.length > 0) {
      // Filter to only incomplete dependencies
      const blockers = task.dependencies.filter(depId => !completedIds.has(depId))
      if (blockers.length > 0) {
        map.set(task.id, blockers)
      }
    }
  }

  return map
})

// Column definitions
const columns: { status: TaskStatus; tasks: typeof pendingTasks }[] = [
  { status: 'pending', tasks: pendingTasks },
  { status: 'in_progress', tasks: inProgressTasks },
  { status: 'completed', tasks: completedTasks }
]

function handleTaskClick(task: Task) {
  emit('taskClick', task)
}
</script>

<template>
  <div class="flex h-full gap-3 overflow-x-auto pb-2">
    <TasksColumn
      v-for="column in columns"
      :key="column.status"
      :status="column.status"
      :tasks="column.tasks.value"
      :blocked-by-map="blockedByMap"
      @task-click="handleTaskClick"
    />
  </div>
</template>
