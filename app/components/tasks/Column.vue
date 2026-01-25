<script setup lang="ts">
import { Circle, PlayCircle, CheckCircle2 } from 'lucide-vue-next'
import type { Task, TaskStatus } from '~/types/task'

const props = defineProps<{
  status: TaskStatus
  tasks: Task[]
  /** Map of task ID to array of blocking task IDs */
  blockedByMap?: Map<string, string[]>
}>()

const emit = defineEmits<{
  taskClick: [task: Task]
}>()

// Status configuration for styling
const statusConfig = computed(() => {
  switch (props.status) {
    case 'pending':
      return {
        label: 'Pending',
        icon: Circle,
        headerClass: 'bg-muted/50',
        iconClass: 'text-muted-foreground'
      }
    case 'in_progress':
      return {
        label: 'In Progress',
        icon: PlayCircle,
        headerClass: 'bg-blue-500/10',
        iconClass: 'text-blue-500'
      }
    case 'completed':
      return {
        label: 'Completed',
        icon: CheckCircle2,
        headerClass: 'bg-green-500/10',
        iconClass: 'text-green-500'
      }
    default:
      return {
        label: props.status,
        icon: Circle,
        headerClass: 'bg-muted/50',
        iconClass: 'text-muted-foreground'
      }
  }
})

function getBlockedBy(taskId: string): string[] {
  return props.blockedByMap?.get(taskId) ?? []
}

function handleTaskClick(task: Task) {
  emit('taskClick', task)
}
</script>

<template>
  <div class="flex h-full min-w-56 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
    <!-- Column Header -->
    <div
      class="flex items-center gap-2 rounded-t-lg border-b border-border px-3 py-2"
      :class="statusConfig.headerClass"
    >
      <component
        :is="statusConfig.icon"
        class="size-4"
        :class="statusConfig.iconClass"
      />
      <h3 class="text-sm font-medium">{{ statusConfig.label }}</h3>
      <span class="ml-auto text-xs text-muted-foreground">
        {{ tasks.length }}
      </span>
    </div>

    <!-- Task Cards -->
    <div class="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-1.5">
      <div class="space-y-1.5">
        <TasksCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
          :blocked-by="getBlockedBy(task.id)"
          @click="handleTaskClick"
        />

        <!-- Empty state -->
        <div
          v-if="tasks.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No tasks
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>
