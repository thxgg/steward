<script setup lang="ts">
import dagre from '@dagrejs/dagre'
import { markRaw } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  MarkerType,
  Position,
  VueFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseEvent
} from '@vue-flow/core'
import { AlertCircle, Circle, Clock3, CheckCircle2, AlertTriangle, Loader2, GitBranch } from 'lucide-vue-next'
import type { GraphNode, GraphPayload } from '~/types/graph'
import GraphNodeComponent from './Node.vue'

type TaskClickPayload = {
  prdSlug: string
  taskId: string
}

type FlowNodeData = GraphNode & {
  showPrdLabel?: boolean
}

const props = withDefaults(defineProps<{
  payload: GraphPayload | null
  scope: 'prd' | 'repo'
  loading?: boolean
  error?: string | null
}>(), {
  loading: false,
  error: null
})

const emit = defineEmits<{
  taskClick: [payload: TaskClickPayload]
}>()

const nodeTypes = {
  task: markRaw(GraphNodeComponent),
  external: markRaw(GraphNodeComponent)
}

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const flowVersion = ref(0)

watch(
  () => [props.scope, props.payload?.scope, props.payload?.nodes.length, props.payload?.edges.length],
  () => {
    flowVersion.value += 1
  },
  { deep: false }
)

const flowKey = computed(() => `${props.scope}-${flowVersion.value}`)

const hasTaskNodes = computed(() => {
  if (!props.payload) {
    return false
  }

  return props.payload.nodes.some((node) => node.kind === 'task')
})

const graphStats = computed(() => props.payload?.stats)

function getNodeDimensions(node: GraphNode, scope: 'prd' | 'repo'): { width: number; height: number } {
  if (node.kind === 'external') {
    return { width: 272, height: 80 }
  }

  if (scope === 'repo') {
    return { width: 272, height: 116 }
  }

  return { width: 272, height: 96 }
}

function getLayoutConfig(scope: 'prd' | 'repo') {
  if (scope === 'repo') {
    return {
      ranksep: 136,
      nodesep: 88,
      edgesep: 34,
      marginx: 36,
      marginy: 28
    }
  }

  return {
    ranksep: 102,
    nodesep: 56,
    edgesep: 20,
    marginx: 24,
    marginy: 22
  }
}

function layoutGraph(nodes: FlowNode<FlowNodeData>[], edges: FlowEdge[]): FlowNode<FlowNodeData>[] {
  const graph = new dagre.graphlib.Graph()
  const config = getLayoutConfig(props.scope)

  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'TB',
    ranker: 'network-simplex',
    ...config
  })

  for (const node of nodes) {
    const dimensions = getNodeDimensions(node.data as FlowNodeData, props.scope)
    graph.setNode(node.id, dimensions)
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target)
  }

  dagre.layout(graph)

  return nodes.map((node) => {
    const dimensions = getNodeDimensions(node.data as FlowNodeData, props.scope)
    const positioned = graph.node(node.id)

    if (!positioned) {
      return node
    }

    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: {
        x: positioned.x - dimensions.width / 2,
        y: positioned.y - dimensions.height / 2
      }
    }
  })
}

const flowEdges = computed<FlowEdge[]>(() => {
  if (!props.payload) {
    return []
  }

  return props.payload.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'step',
    animated: edge.unresolved && !prefersReducedMotion.value,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16
    },
    style: {
      strokeWidth: edge.unresolved ? 1.4 : 1.7,
      stroke: edge.unresolved ? 'var(--muted-foreground)' : 'var(--border)',
      strokeOpacity: edge.unresolved ? 0.62 : 0.95,
      strokeDasharray: edge.unresolved ? '5 4' : undefined
    }
  }))
})

const flowNodes = computed<FlowNode<FlowNodeData>[]>(() => {
  if (!props.payload) {
    return []
  }

  const baseNodes: FlowNode<FlowNodeData>[] = props.payload.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    data: {
      ...node,
      showPrdLabel: node.kind === 'task' ? props.scope === 'repo' : undefined
    },
    draggable: false,
    selectable: node.kind === 'task',
    connectable: false,
    position: { x: 0, y: 0 }
  }))

  return layoutGraph(baseNodes, flowEdges.value)
})

function handleNodeClick(event: NodeMouseEvent) {
  const node = event.node as FlowNode<FlowNodeData>
  const data = node.data

  if (!data || data.kind !== 'task') {
    return
  }

  emit('taskClick', {
    prdSlug: data.prdSlug,
    taskId: data.taskId
  })
}
</script>

<template>
  <div class="relative h-full overflow-hidden rounded-lg border border-border bg-card">
    <div v-if="loading" class="flex h-full items-center justify-center">
      <div class="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="size-5 animate-spin" />
        <span>Building graph...</span>
      </div>
    </div>

    <div v-else-if="error" class="flex h-full items-center justify-center p-6">
      <div class="max-w-sm text-center">
        <AlertCircle class="mx-auto mb-3 size-8 text-destructive" />
        <p class="text-sm font-medium">Graph unavailable</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ error }}</p>
      </div>
    </div>

    <div v-else-if="!payload || !hasTaskNodes" class="flex h-full items-center justify-center p-6">
      <div class="max-w-sm text-center">
        <GitBranch class="mx-auto mb-3 size-8 text-muted-foreground/60" />
        <p class="text-sm font-medium">No graphable tasks yet</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ scope === 'repo' ? 'No PRDs with task state were found in this repository.' : 'This PRD does not have generated tasks yet.' }}
        </p>
      </div>
    </div>

    <VueFlow
      v-else
      :key="flowKey"
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :fit-view-on-init="true"
      :fit-view-on-init-options="{ padding: 0.2 }"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :zoom-on-scroll="true"
      :pan-on-drag="true"
      :min-zoom="0.2"
      :max-zoom="1.8"
      class="h-full"
      @node-click="handleNodeClick"
    >
      <Background :gap="20" :size="1.2" variant="dots" color="var(--border)" />
      <Controls position="bottom-left" :show-interactive="false" />
    </VueFlow>

    <div v-if="payload && hasTaskNodes" class="pointer-events-none absolute top-3 left-3 z-10 rounded-md border border-border bg-background/95 p-2.5 shadow-sm">
      <p class="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Legend</p>
      <div class="space-y-1 text-xs">
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <Circle class="size-3.5" />
          Pending
        </div>
        <div class="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
          <Clock3 class="size-3.5" />
          In Progress
        </div>
        <div class="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 class="size-3.5" />
          Completed
        </div>
        <div class="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle class="size-3.5" />
          Missing dependency
        </div>
      </div>
    </div>

    <div v-if="graphStats && hasTaskNodes" class="pointer-events-none absolute top-3 right-3 z-10 rounded-md border border-border bg-background/95 p-2.5 shadow-sm">
      <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span class="rounded bg-muted px-1.5 py-0.5">Total {{ graphStats.total }}</span>
        <span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">WIP {{ graphStats.inProgress }}</span>
        <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">Done {{ graphStats.completed }}</span>
        <span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">Missing {{ graphStats.unresolved }}</span>
      </div>
    </div>
  </div>
</template>
