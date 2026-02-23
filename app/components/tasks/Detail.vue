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
  Link2,
  Check,
  Diff,
  ArrowLeft,
  ExternalLink
} from 'lucide-vue-next'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose
} from '~/components/ui/sheet'
import { Badge } from '~/components/ui/badge'
import { Separator } from '~/components/ui/separator'
import { Button } from '~/components/ui/button'
import type { Task, CommitRef } from '~/types/task'

const props = defineProps<{
  task: Task | null
  /** Map of task ID to task title for displaying dependency names */
  taskTitles?: Map<string, string>
  /** Git commits associated with this task (resolved with repo context) */
  commits?: CommitRef[]
  /** Repository ID for fetching commit details */
  repoId?: string
  /** PRD slug that owns the currently selected task */
  taskPrdSlug?: string | null
  /** Current route PRD slug */
  currentPrdSlug?: string | null
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

// Has commits to show
const hasCommits = computed(() => props.commits && props.commits.length > 0 && props.repoId)

const showOpenPrdLink = computed(() => {
  if (!props.repoId || !props.taskPrdSlug) {
    return false
  }

  if (!props.currentPrdSlug) {
    return true
  }

  return props.taskPrdSlug !== props.currentPrdSlug
})

const openPrdHref = computed(() => {
  if (!showOpenPrdLink.value || !props.repoId || !props.taskPrdSlug || !props.task) {
    return ''
  }

  const params = new URLSearchParams({
    task: props.task.id,
    taskPrd: props.taskPrdSlug
  })

  return `/${props.repoId}/${props.taskPrdSlug}?${params.toString()}`
})

// View state: 'details' or 'diff'
const viewMode = ref<'details' | 'diff'>('details')
const selectedCommitSha = ref<string | null>(null)
const selectedCommitRepo = ref<string | null>(null)

// Handle commit selection (now receives sha and repo)
function handleCommitSelect(sha: string, repo?: string) {
  selectedCommitSha.value = sha
  selectedCommitRepo.value = repo || null
  viewMode.value = 'diff'
}

// Go back to details view
function handleBackToDetails() {
  viewMode.value = 'details'
  selectedCommitSha.value = null
  selectedCommitRepo.value = null
}

// Reset view when task changes or sheet closes
watch(() => props.task, () => {
  viewMode.value = 'details'
  selectedCommitSha.value = null
  selectedCommitRepo.value = null
})

watch(open, (isOpen) => {
  if (!isOpen) {
    viewMode.value = 'details'
    selectedCommitSha.value = null
    selectedCommitRepo.value = null
  }
})
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      class="flex h-full w-full flex-col overflow-hidden sm:max-w-lg"
      :class="viewMode === 'diff' ? 'sm:!max-w-[94vw] xl:!max-w-[88vw]' : ''"
    >
      <!-- Header with back button when viewing diff -->
      <SheetHeader v-if="task" class="px-6 pr-12">
        <div class="flex items-center gap-2">
          <Button
            v-if="viewMode === 'diff'"
            variant="ghost"
            size="icon"
            class="size-8 shrink-0"
            @click="handleBackToDetails"
          >
            <ArrowLeft class="size-4" />
          </Button>
          <SheetTitle class="text-left text-lg">
            {{ viewMode === 'diff' ? 'Commit Changes' : task.title }}
          </SheetTitle>
        </div>
        <SheetDescription class="sr-only">Task details</SheetDescription>
      </SheetHeader>

      <!-- Diff View -->
      <div v-if="task && viewMode === 'diff' && selectedCommitSha && repoId" class="min-h-0 flex-1 overflow-hidden">
        <GitDiffPanel :repo-id="repoId" :commit-sha="selectedCommitSha" :repo-path="selectedCommitRepo || undefined" class="h-full" @close="handleBackToDetails" />
      </div>

      <!-- Details View -->
      <div v-else-if="task" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
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
          <ul class="space-y-1.5 text-sm text-muted-foreground">
            <li v-for="(pass, index) in task.passes" :key="index" class="flex items-start gap-2">
              <div
                class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border"
                :class="task.status === 'completed' ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'"
              >
                <Check v-if="task.status === 'completed'" class="size-3" />
              </div>
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

        <!-- Changes (commits) -->
        <template v-if="hasCommits">
          <Separator />
          <div class="space-y-2">
            <h4 class="flex items-center gap-2 text-sm font-medium">
              <Diff class="size-4" />
              Changes
            </h4>
            <GitCommitList
              :commits="commits!"
              :repo-id="repoId!"
              @select="handleCommitSelect"
            />
          </div>
        </template>

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

        <div v-if="showOpenPrdLink" class="space-y-2">
          <Separator />
          <div class="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span class="text-muted-foreground">This task belongs to {{ taskPrdSlug }}.</span>
            <NuxtLink :to="openPrdHref">
              <Button variant="outline" size="sm" class="h-8">
                <ExternalLink class="mr-1.5 size-3.5" />
                Open PRD
              </Button>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Close button - always at bottom -->
      <SheetFooter class="px-6 pb-6">
        <SheetClose as-child>
          <Button variant="outline" class="w-full">Close</Button>
        </SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
