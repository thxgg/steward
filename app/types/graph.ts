import type { TaskCategory, TaskPriority, TaskStatus } from './task.js'

export type GraphScope = 'prd' | 'repo'

export interface GraphTaskNode {
  id: string
  kind: 'task'
  taskId: string
  prdSlug: string
  prdName: string
  title: string
  status: TaskStatus
  category: TaskCategory
  priority: TaskPriority
}

export interface GraphExternalNode {
  id: string
  kind: 'external'
  title: string
  unresolved: true
  dependencyRef: string
}

export type GraphNode = GraphTaskNode | GraphExternalNode

export interface GraphDependencyEdge {
  id: string
  source: string
  target: string
  type: 'dependency'
  unresolved?: boolean
}

export interface GraphStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  unresolved: number
}

export interface GraphPayloadBase {
  scope: GraphScope
  repoId: string
  nodes: GraphNode[]
  edges: GraphDependencyEdge[]
  stats: GraphStats
}

export interface GraphPrdPayload extends GraphPayloadBase {
  scope: 'prd'
  prdSlug: string
}

export interface GraphRepoPayload extends GraphPayloadBase {
  scope: 'repo'
  prds: string[]
}

export type GraphPayload = GraphPrdPayload | GraphRepoPayload
