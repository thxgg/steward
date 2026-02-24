import { promises as fs } from 'node:fs'
import type {
  GraphDependencyEdge,
  GraphExternalNode,
  GraphNode,
  GraphPrdPayload,
  GraphRepoPayload,
  GraphStats,
  GraphTaskNode
} from '../../app/types/graph.js'
import type { RepoConfig } from '../../app/types/repo.js'
import type { Task } from '../../app/types/task.js'
import { getPrdState, getPrdStateSummaries, migrateLegacyStateForRepo } from './prd-state.js'
import { resolvePrdMarkdownPath } from './prd-service.js'

type GraphPrdInput = {
  prdSlug: string
  prdName: string
  tasks: Task[]
}

type ParsedDependency = {
  prdSlug: string
  taskId: string
  reference: string
}

const NODE_SEPARATOR = '::'
const MISSING_PREFIX = 'missing'

export function createTaskNodeId(prdSlug: string, taskId: string): string {
  return `${prdSlug}${NODE_SEPARATOR}${taskId}`
}

function createMissingNodeId(prdSlug: string, taskId: string): string {
  return `${MISSING_PREFIX}${NODE_SEPARATOR}${prdSlug}${NODE_SEPARATOR}${taskId}`
}

function createEdgeId(source: string, target: string): string {
  return `${source}->${target}`
}

function parseDependency(rawDependency: string, currentPrdSlug: string): ParsedDependency {
  const trimmed = rawDependency.trim()
  if (!trimmed) {
    return {
      prdSlug: currentPrdSlug,
      taskId: rawDependency,
      reference: rawDependency
    }
  }

  const parts = trimmed.split(NODE_SEPARATOR)
  if (parts.length === 2) {
    const [prdSlug, taskId] = parts
    if (prdSlug && taskId) {
      return {
        prdSlug,
        taskId,
        reference: `${prdSlug}${NODE_SEPARATOR}${taskId}`
      }
    }
  }

  return {
    prdSlug: currentPrdSlug,
    taskId: trimmed,
    reference: trimmed
  }
}

async function resolvePrdName(repo: RepoConfig, prdSlug: string): Promise<string> {
  try {
    const prdPath = resolvePrdMarkdownPath(repo.path, prdSlug)
    const content = await fs.readFile(prdPath, 'utf-8')
    const h1Match = content.match(/^#\s+(.+)$/m)
    return h1Match?.[1]?.trim() || prdSlug
  } catch {
    return prdSlug
  }
}

function buildStats(taskNodes: GraphTaskNode[], unresolvedCount: number): GraphStats {
  const pending = taskNodes.filter((node) => node.status === 'pending').length
  const inProgress = taskNodes.filter((node) => node.status === 'in_progress').length
  const completed = taskNodes.filter((node) => node.status === 'completed').length

  return {
    total: taskNodes.length,
    pending,
    inProgress,
    completed,
    unresolved: unresolvedCount
  }
}

function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'task' ? -1 : 1
    }
    return a.id.localeCompare(b.id)
  })
}

function sortEdges(edges: GraphDependencyEdge[]): GraphDependencyEdge[] {
  return [...edges].sort((a, b) => a.id.localeCompare(b.id))
}

function buildGraphFromInputs(inputs: GraphPrdInput[]): {
  nodes: GraphNode[]
  edges: GraphDependencyEdge[]
  stats: GraphStats
} {
  const taskNodes = new Map<string, GraphTaskNode>()
  const missingNodes = new Map<string, GraphExternalNode>()
  const edges = new Map<string, GraphDependencyEdge>()

  for (const input of inputs) {
    for (const task of input.tasks) {
      const nodeId = createTaskNodeId(input.prdSlug, task.id)
      taskNodes.set(nodeId, {
        id: nodeId,
        kind: 'task',
        taskId: task.id,
        prdSlug: input.prdSlug,
        prdName: input.prdName,
        title: task.title,
        status: task.status,
        category: task.category,
        priority: task.priority
      })
    }
  }

  for (const input of inputs) {
    for (const task of input.tasks) {
      const targetId = createTaskNodeId(input.prdSlug, task.id)

      for (const rawDependency of task.dependencies) {
        const dependency = parseDependency(rawDependency, input.prdSlug)
        const sourceTaskId = createTaskNodeId(dependency.prdSlug, dependency.taskId)

        if (taskNodes.has(sourceTaskId)) {
          const edgeId = createEdgeId(sourceTaskId, targetId)
          edges.set(edgeId, {
            id: edgeId,
            source: sourceTaskId,
            target: targetId,
            type: 'dependency'
          })
          continue
        }

        const missingNodeId = createMissingNodeId(dependency.prdSlug, dependency.taskId)
        if (!missingNodes.has(missingNodeId)) {
          missingNodes.set(missingNodeId, {
            id: missingNodeId,
            kind: 'external',
            title: `Missing: ${dependency.reference}`,
            unresolved: true,
            dependencyRef: dependency.reference
          })
        }

        const unresolvedEdgeId = createEdgeId(missingNodeId, targetId)
        edges.set(unresolvedEdgeId, {
          id: unresolvedEdgeId,
          source: missingNodeId,
          target: targetId,
          type: 'dependency',
          unresolved: true
        })
      }
    }
  }

  const taskNodeList = [...taskNodes.values()]
  const nodeList = sortNodes([...taskNodeList, ...missingNodes.values()])
  const edgeList = sortEdges([...edges.values()])

  return {
    nodes: nodeList,
    edges: edgeList,
    stats: buildStats(taskNodeList, missingNodes.size)
  }
}

export async function buildPrdGraph(repo: RepoConfig, prdSlug: string): Promise<GraphPrdPayload> {
  await migrateLegacyStateForRepo(repo)

  const [state, prdName] = await Promise.all([
    getPrdState(repo.id, prdSlug),
    resolvePrdName(repo, prdSlug)
  ])

  const tasks = Array.isArray(state?.tasks?.tasks) ? state!.tasks!.tasks : []
  const graph = buildGraphFromInputs([
    {
      prdSlug,
      prdName,
      tasks
    }
  ])

  return {
    scope: 'prd',
    repoId: repo.id,
    prdSlug,
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats
  }
}

export async function buildRepoGraph(repo: RepoConfig): Promise<GraphRepoPayload> {
  await migrateLegacyStateForRepo(repo)

  const summaries = await getPrdStateSummaries(repo.id)
  const slugs = [...summaries.keys()].sort((a, b) => a.localeCompare(b))

  const inputs: GraphPrdInput[] = []

  for (const slug of slugs) {
    const state = await getPrdState(repo.id, slug)
    const tasks = state?.tasks?.tasks
    if (!Array.isArray(tasks)) {
      continue
    }

    inputs.push({
      prdSlug: slug,
      prdName: await resolvePrdName(repo, slug),
      tasks
    })
  }

  const graph = buildGraphFromInputs(inputs)

  return {
    scope: 'repo',
    repoId: repo.id,
    prds: inputs.map((input) => input.prdSlug).sort((a, b) => a.localeCompare(b)),
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats
  }
}
