/**
 * Task category
 */
export type TaskCategory = 'setup' | 'feature' | 'integration' | 'testing' | 'documentation'

/**
 * Task priority level
 */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

/**
 * Task status
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/**
 * Individual task from tasks.json
 */
export interface Task {
  /** Unique task identifier (e.g., "task-001") */
  id: string
  /** Task category */
  category: TaskCategory
  /** Short task title */
  title: string
  /** Detailed description of what needs to be done */
  description: string
  /** Specific implementation steps */
  steps: string[]
  /** Verification criteria for completion */
  passes: string[]
  /** IDs of tasks this task depends on */
  dependencies: string[]
  /** Task priority */
  priority: TaskPriority
  /** Current task status */
  status: TaskStatus
  /** ISO timestamp when task was started */
  startedAt?: string
  /** ISO timestamp when task was completed */
  completedAt?: string
}

/**
 * PRD metadata in tasks.json
 */
export interface TasksPrdInfo {
  /** PRD name/title */
  name: string
  /** Path to source PRD markdown file */
  source: string
  /** Shortcut story ID if linked */
  shortcutStory?: string
  /** ISO timestamp when tasks were created */
  createdAt: string
}

/**
 * Full tasks.json structure
 */
export interface TasksFile {
  /** PRD information */
  prd: TasksPrdInfo
  /** Array of tasks */
  tasks: Task[]
}

/**
 * Pattern discovered during implementation
 */
export interface ProgressPattern {
  /** Pattern name */
  name: string
  /** Pattern description */
  description: string
}

/**
 * Log entry for a completed task
 */
export interface TaskLog {
  /** Task ID */
  taskId: string
  /** Task status */
  status: TaskStatus
  /** ISO timestamp when task was started */
  startedAt: string
  /** ISO timestamp when task was completed */
  completedAt?: string
  /** Description of what was implemented */
  implemented?: string
  /** Files that were changed */
  filesChanged?: string[]
  /** Learnings or patterns discovered */
  learnings?: string
  /** Git commit SHAs associated with this task */
  commits?: string[]
}

/**
 * Progress tracking file structure (progress.json)
 */
export interface ProgressFile {
  /** PRD name */
  prdName: string
  /** Shortcut story ID if linked */
  shortcutStory?: string
  /** Total number of tasks */
  totalTasks: number
  /** Number of completed tasks */
  completed: number
  /** Number of in-progress tasks */
  inProgress: number
  /** Number of blocked tasks */
  blocked: number
  /** ISO timestamp when work started */
  startedAt: string | null
  /** ISO timestamp of last update */
  lastUpdated: string
  /** Discovered patterns */
  patterns: ProgressPattern[]
  /** Task completion logs */
  taskLogs: TaskLog[]
}
