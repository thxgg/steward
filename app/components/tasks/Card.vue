<script setup lang="ts">
import { AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-vue-next'
import { Card, CardContent } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import type { Task } from '~/types/task'

const props = defineProps<{
  task: Task
  /** IDs of tasks that are blocking this one (not completed) */
  blockedBy?: string[]
}>()

const emit = defineEmits<{
  click: [task: Task]
}>()

// Category badge styling
const categoryConfig = computed(() => {
  switch (props.task.category) {
    case 'setup':
      return { label: 'Setup', variant: 'secondary' as const }
    case 'feature':
      return { label: 'Feature', variant: 'default' as const }
    case 'integration':
      return { label: 'Integration', variant: 'outline' as const }
    case 'testing':
      return { label: 'Testing', variant: 'secondary' as const }
    case 'documentation':
      return { label: 'Docs', variant: 'secondary' as const }
    default:
      return { label: props.task.category, variant: 'secondary' as const }
  }
})

// Priority indicator
const priorityConfig = computed(() => {
  switch (props.task.priority) {
    case 'critical':
      return { icon: ArrowUp, class: 'text-destructive', label: 'Critical' }
    case 'high':
      return { icon: ArrowUp, class: 'text-orange-500', label: 'High' }
    case 'medium':
      return { icon: Minus, class: 'text-muted-foreground', label: 'Medium' }
    case 'low':
      return { icon: ArrowDown, class: 'text-muted-foreground', label: 'Low' }
    default:
      return { icon: Minus, class: 'text-muted-foreground', label: 'Unknown' }
  }
})

// Check if task is blocked
const isBlocked = computed(() => {
  return props.blockedBy && props.blockedBy.length > 0
})

// Extract task number from ID (e.g., "task-001" -> 1)
const taskNumber = computed(() => {
  const match = props.task.id.match(/(\d+)$/)
  const value = match?.[1]
  return value ? parseInt(value, 10) : 0
})

const blockedCount = computed(() => {
  return props.blockedBy?.length ?? 0
})

function handleClick() {
  emit('click', props.task)
}
</script>

<template>
  <Card
    class="cursor-pointer py-0 gap-0 transition-all hover:shadow-md hover:border-primary/50"
    :class="{ 'opacity-60': isBlocked }"
    @click="handleClick"
  >
    <CardContent class="p-2.5">
      <!-- Header: Category + Priority -->
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <Badge :variant="categoryConfig.variant" class="text-xs">
          {{ categoryConfig.label }}
        </Badge>
        <component
          :is="priorityConfig.icon"
          class="size-4"
          :class="priorityConfig.class"
          :title="priorityConfig.label"
        />
      </div>

      <!-- Title -->
      <h4 class="text-sm font-medium leading-snug">
        <span class="text-muted-foreground">#{{ taskNumber }}</span>
        {{ task.title }}
      </h4>

      <!-- Blocked indicator -->
      <div
        v-if="isBlocked"
        class="mt-2 flex items-center gap-1.5 text-xs text-destructive"
      >
        <AlertCircle class="size-3.5" />
        <span>Blocked by {{ blockedCount }} task{{ blockedCount === 1 ? '' : 's' }}</span>
      </div>
    </CardContent>
  </Card>
</template>
