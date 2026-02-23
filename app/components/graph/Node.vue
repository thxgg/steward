<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Circle, Clock3 } from 'lucide-vue-next'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import type { GraphNode } from '~/types/graph'

type RenderNodeData = GraphNode & {
  showPrdLabel?: boolean
}

const props = defineProps<NodeProps<RenderNodeData>>()

const data = computed(() => props.data)

const taskData = computed(() => data.value.kind === 'task' ? data.value : null)
const externalData = computed(() => data.value.kind === 'external' ? data.value : null)

const statusConfig = computed(() => {
  if (data.value.kind !== 'task') {
    return {
      label: 'Missing dependency',
      icon: AlertTriangle,
      class: 'text-amber-600 dark:text-amber-400'
    }
  }

  switch (data.value.status) {
    case 'completed':
      return {
        label: 'Completed',
        icon: CheckCircle2,
        class: 'text-emerald-600 dark:text-emerald-400'
      }
    case 'in_progress':
      return {
        label: 'In Progress',
        icon: Clock3,
        class: 'text-blue-600 dark:text-blue-400'
      }
    case 'pending':
    default:
      return {
        label: 'Pending',
        icon: Circle,
        class: 'text-muted-foreground'
      }
  }
})

const priorityLabel = computed(() => {
  if (data.value.kind !== 'task') {
    return null
  }

  return data.value.priority.replace('_', ' ')
})

const categoryLabel = computed(() => {
  if (data.value.kind !== 'task') {
    return null
  }

  return data.value.category
})

const nodeClass = computed(() => {
  if (data.value.kind === 'external') {
    return [
      'border-amber-500/60 bg-amber-50/70 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
      'border-dashed'
    ]
  }

  if (data.value.status === 'completed') {
    return [
      'border-emerald-500/40 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100',
      'border-solid'
    ]
  }

  if (data.value.status === 'in_progress') {
    return [
      'border-blue-500/40 bg-blue-50/80 text-blue-950 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100',
      'border-solid'
    ]
  }

  return [
    'border-border bg-card text-card-foreground',
    'border-solid'
  ]
})
</script>

<template>
  <div
    class="w-[17rem] rounded-xl border px-3 py-2 shadow-sm transition-[transform,box-shadow,border-color] duration-150 ease-[var(--ease-out-cubic)] motion-reduce:transition-none"
    :class="[
      nodeClass,
      selected ? 'ring-2 ring-primary/30 shadow-md' : 'hover:shadow-md hover:border-primary/40'
    ]"
  >
    <Handle
      type="target"
      :position="Position.Top"
      class="!h-2 !w-2 !border-0 !bg-transparent !opacity-0 !pointer-events-none"
    />

    <div v-if="taskData" class="space-y-2">
      <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span class="font-mono">{{ taskData.taskId }}</span>
        <span
          v-if="taskData.showPrdLabel"
          class="rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px]"
        >
          {{ taskData.prdSlug }}
        </span>
      </div>

      <p class="line-clamp-2 text-sm font-medium leading-snug">
        {{ taskData.title }}
      </p>

      <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div class="flex items-center gap-1.5" :class="statusConfig.class">
          <component :is="statusConfig.icon" class="size-3.5" />
          <span>{{ statusConfig.label }}</span>
        </div>
        <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
          <span class="rounded bg-background/60 px-1.5 py-0.5">{{ categoryLabel }}</span>
          <span class="rounded bg-background/60 px-1.5 py-0.5">{{ priorityLabel }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="externalData" class="space-y-1.5">
      <div class="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle class="size-4" />
        <span>{{ externalData.title }}</span>
      </div>
      <p class="font-mono text-[11px] text-muted-foreground">
        {{ externalData.dependencyRef }}
      </p>
    </div>

    <Handle
      type="source"
      :position="Position.Bottom"
      class="!h-2 !w-2 !border-0 !bg-transparent !opacity-0 !pointer-events-none"
    />
  </div>
</template>
