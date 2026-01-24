<script setup lang="ts">
import {
  Calendar,
  Clock,
  Tag,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ListOrdered,
  CheckSquare,
  Link2
} from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose
} from '~/components/ui/sheet'
import { Badge } from '~/components/ui/badge'
import { Separator } from '~/components/ui/separator'
import { Button } from '~/components/ui/button'
import type { Task } from '~/types/task'

const props = defineProps<{
  task: Task | null
  /** Map of task ID to task title for displaying dependency names */
  taskTitles?: Map<string, string>
}>()

const open = defineModel<boolean>('open', { default: false })

// Category badge styling
const categoryConfig = computed(() => {
  if (!props.task) return { label: '', variant: 'secondary' as const }
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

// Priority styling
const priorityConfig = computed(() => {
  if (!props.task) return { label: '', class: '' }
  switch (props.task.priority) {
    case 'critical':
      return { label: 'Critical', class: 'text-destructive' }
    case 'high':
      return { label: 'High', class: 'text-orange-500' }
    case 'medium':
      return { label: 'Medium', class: 'text-muted-foreground' }
    case 'low':
      return { label: 'Low', class: 'text-muted-foreground' }
    default:
      return { label: props.task.priority, class: 'text-muted-foreground' }
  }
})

// Status styling
const statusConfig = computed(() => {
  if (!props.task) return { label: '', icon: Circle, class: '' }
  switch (props.task.status) {
    case 'pending':
      return { label: 'Pending', icon: Circle, class: 'text-muted-foreground' }
    case 'in_progress':
      return { label: 'In Progress', icon: Clock, class: 'text-blue-500' }
    case 'completed':
      return { label: 'Completed', icon: CheckCircle2, class: 'text-green-500' }
    default:
      return { label: props.task.status, icon: Circle, class: 'text-muted-foreground' }
  }
})

// Format ISO date to readable string
function formatDate(isoString?: string): string {
  if (!isoString) return ''
  try {
    return new Date(isoString).toLocaleString()
  } catch {
    return isoString
  }
}

// Get task title from ID
function getTaskTitle(taskId: string): string {
  return props.taskTitles?.get(taskId) ?? taskId
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent class="w-full overflow-y-auto px-6 sm:max-w-lg">
      <SheetHeader v-if="task" class="pr-6">
        <SheetTitle class="text-left text-lg">{{ task.title }}</SheetTitle>
        <SheetDescription class="sr-only">Task details</SheetDescription>
      </SheetHeader>

      <div v-if="task" class="mt-4 space-y-4">
        <!-- Status, Category, Priority row -->
        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="categoryConfig.variant">
            <Tag class="mr-1 size-3" />
            {{ categoryConfig.label }}
          </Badge>
          <Badge variant="outline" :class="priorityConfig.class">
            <AlertTriangle class="mr-1 size-3" />
            {{ priorityConfig.label }}
          </Badge>
          <Badge variant="outline" :class="statusConfig.class">
            <component :is="statusConfig.icon" class="mr-1 size-3" />
            {{ statusConfig.label }}
          </Badge>
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <h4 class="text-sm font-medium">Description</h4>
          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ task.description }}
          </p>
        </div>

        <Separator />

        <!-- Steps -->
        <div v-if="task.steps.length > 0" class="space-y-2">
          <h4 class="flex items-center gap-2 text-sm font-medium">
            <ListOrdered class="size-4" />
            Steps
          </h4>
          <ol class="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            <li v-for="(step, index) in task.steps" :key="index" class="pl-1">
              {{ step }}
            </li>
          </ol>
        </div>

        <Separator v-if="task.steps.length > 0 && task.passes.length > 0" />

        <!-- Passes (criteria) -->
        <div v-if="task.passes.length > 0" class="space-y-2">
          <h4 class="flex items-center gap-2 text-sm font-medium">
            <CheckSquare class="size-4" />
            Pass Criteria
          </h4>
          <ul class="space-y-1 text-sm text-muted-foreground">
            <li v-for="(pass, index) in task.passes" :key="index" class="flex items-start gap-2">
              <input
                type="checkbox"
                :checked="task.status === 'completed'"
                disabled
                class="mt-0.5 shrink-0"
              />
              <span>{{ pass }}</span>
            </li>
          </ul>
        </div>

        <Separator v-if="task.dependencies.length > 0" />

        <!-- Dependencies -->
        <div v-if="task.dependencies.length > 0" class="space-y-2">
          <h4 class="flex items-center gap-2 text-sm font-medium">
            <Link2 class="size-4" />
            Dependencies
          </h4>
          <ul class="space-y-1 text-sm text-muted-foreground">
            <li v-for="depId in task.dependencies" :key="depId" class="flex items-center gap-2">
              <span class="font-mono text-xs">{{ depId }}</span>
              <span>{{ getTaskTitle(depId) }}</span>
            </li>
          </ul>
        </div>

        <!-- Timestamps -->
        <div v-if="task.startedAt || task.completedAt" class="space-y-2">
          <Separator />
          <div class="flex flex-col gap-1 text-xs text-muted-foreground">
            <div v-if="task.startedAt" class="flex items-center gap-2">
              <Calendar class="size-3" />
              <span>Started: {{ formatDate(task.startedAt) }}</span>
            </div>
            <div v-if="task.completedAt" class="flex items-center gap-2">
              <CheckCircle2 class="size-3" />
              <span>Completed: {{ formatDate(task.completedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Close button -->
      <div class="mt-6">
        <SheetClose as-child>
          <Button variant="outline" class="w-full">Close</Button>
        </SheetClose>
      </div>
    </SheetContent>
  </Sheet>
</template>
