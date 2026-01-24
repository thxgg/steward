<script setup lang="ts">
import type { Task, TaskStatus } from '~/types/task'

const props = defineProps<{
  tasks: Task[]
}>()

const emit = defineEmits<{
  taskClick: [task: Task]
}>()

// Group tasks by status
const pendingTasks = computed(() =>
  props.tasks.filter(t => t.status === 'pending')
)

const inProgressTasks = computed(() =>
  props.tasks.filter(t => t.status === 'in_progress')
)

const completedTasks = computed(() =>
  props.tasks.filter(t => t.status === 'completed')
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

<style scoped>
/* On narrow screens, allow horizontal scroll */
@media (max-width: 768px) {
  .flex {
    min-width: max-content;
  }
}
</style>
