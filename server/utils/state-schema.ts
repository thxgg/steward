import { z } from 'zod'
import type { ProgressFile, TasksFile } from '../../app/types/task.js'

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
const taskCategorySchema = z.enum(['setup', 'feature', 'integration', 'testing', 'documentation'])
const taskPrioritySchema = z.enum(['critical', 'high', 'medium', 'low'])

const commitRefSchema = z.object({
  sha: z.string().min(1),
  repo: z.string()
})

const taskStatusValues = new Set(['pending', 'in_progress', 'completed'] as const)

const taskSchema = z.object({
  id: z.string().min(1),
  category: taskCategorySchema,
  title: z.string(),
  description: z.string(),
  steps: z.array(z.string()).default([]),
  passes: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional()
})

const tasksFileSchema = z.object({
  prd: z.object({
    name: z.string(),
    source: z.string(),
    shortcutStory: z.string().optional(),
    createdAt: z.string()
  }),
  tasks: z.array(taskSchema)
})

const taskLogSchema = z.object({
  taskId: z.string().min(1),
  status: taskStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  implemented: z.string().optional(),
  filesChanged: z.array(z.string()).optional(),
  learnings: z.string().optional(),
  commits: z.array(z.union([z.string().min(1), commitRefSchema])).optional()
})

const progressPatternSchema = z.union([
  z.string().trim().min(1).transform((value) => ({
    name: value,
    description: value
  })),
  z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional()
  }).transform((value) => ({
    name: value.name,
    description: value.description ?? value.name
  }))
])

const progressFileSchema = z.object({
  prdName: z.string(),
  shortcutStory: z.string().optional(),
  totalTasks: z.number(),
  completed: z.number(),
  inProgress: z.number(),
  blocked: z.number(),
  startedAt: z.string().nullable(),
  lastUpdated: z.string(),
  patterns: z.array(progressPatternSchema),
  taskLogs: z.array(taskLogSchema)
})

const progressInputSchema = z.object({
  prdName: z.string().trim().min(1).optional(),
  startedAt: z.union([z.string(), z.null()]).optional(),
  started: z.union([z.string(), z.null()]).optional(),
  totalTasks: z.number().optional(),
  completed: z.union([z.number(), z.array(z.unknown())]).optional(),
  inProgress: z.union([z.number(), z.null()]).optional(),
  blocked: z.number().optional(),
  lastUpdated: z.string().optional(),
  patterns: z.array(z.unknown()).optional(),
  taskLogs: z.array(z.unknown()).optional(),
  taskProgress: z.record(z.object({
    status: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    implemented: z.string().optional(),
    filesChanged: z.array(z.string()).optional(),
    learnings: z.string().optional(),
    commits: z.array(z.union([z.string().min(1), commitRefSchema])).optional()
  })).optional()
}).passthrough()

export type ProgressNormalizationOptions = {
  prdNameFallback?: string
  totalTasksHint?: number
  now?: string
}

function coerceNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(0, Math.floor(value))
}

function normalizeTaskLogStatus(value: unknown): 'pending' | 'in_progress' | 'completed' {
  if (typeof value === 'string' && taskStatusValues.has(value as 'pending' | 'in_progress' | 'completed')) {
    return value as 'pending' | 'in_progress' | 'completed'
  }

  return 'pending'
}

function normalizeLegacyTaskProgress(
  taskProgress: Record<string, {
    status?: string
    startedAt?: string
    completedAt?: string
    implemented?: string
    filesChanged?: string[]
    learnings?: string
    commits?: (string | { sha: string; repo: string })[]
  }> | undefined,
  now: string
): ProgressFile['taskLogs'] {
  if (!taskProgress) {
    return []
  }

  return Object.entries(taskProgress).map(([taskId, value]) => ({
    taskId,
    status: normalizeTaskLogStatus(value.status),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : now,
    ...(typeof value.completedAt === 'string' && { completedAt: value.completedAt }),
    ...(typeof value.implemented === 'string' && { implemented: value.implemented }),
    ...(Array.isArray(value.filesChanged) && { filesChanged: value.filesChanged }),
    ...(typeof value.learnings === 'string' && { learnings: value.learnings }),
    ...(Array.isArray(value.commits) && { commits: value.commits })
  }))
}

function normalizePatterns(patterns: unknown[] | undefined): ProgressFile['patterns'] {
  if (!patterns) {
    return []
  }

  const normalized: ProgressFile['patterns'] = []
  for (const pattern of patterns) {
    const parsed = progressPatternSchema.safeParse(pattern)
    if (parsed.success) {
      normalized.push(parsed.data)
    }
  }

  return normalized
}

function normalizeTaskLogs(taskLogs: unknown[] | undefined, now: string): ProgressFile['taskLogs'] {
  if (!taskLogs) {
    return []
  }

  const normalized: ProgressFile['taskLogs'] = []

  for (const taskLog of taskLogs) {
    const parsed = taskLogSchema.safeParse(taskLog)
    if (parsed.success) {
      normalized.push(parsed.data)
      continue
    }

    if (!taskLog || typeof taskLog !== 'object' || Array.isArray(taskLog)) {
      continue
    }

    const raw = taskLog as Record<string, unknown>
    if (typeof raw.taskId !== 'string' || raw.taskId.trim().length === 0) {
      continue
    }

    const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : now
    const commits = Array.isArray(raw.commits)
      ? raw.commits.filter((commit) => {
        if (typeof commit === 'string' && commit.trim().length > 0) {
          return true
        }

        if (!commit || typeof commit !== 'object' || Array.isArray(commit)) {
          return false
        }

        const ref = commit as Record<string, unknown>
        return typeof ref.sha === 'string' && ref.sha.trim().length > 0 && typeof ref.repo === 'string'
      }) as (string | { sha: string; repo: string })[]
      : undefined

    normalized.push({
      taskId: raw.taskId,
      status: normalizeTaskLogStatus(raw.status),
      startedAt,
      ...(typeof raw.completedAt === 'string' && { completedAt: raw.completedAt }),
      ...(typeof raw.implemented === 'string' && { implemented: raw.implemented }),
      ...(Array.isArray(raw.filesChanged) && {
        filesChanged: raw.filesChanged.filter((file): file is string => typeof file === 'string')
      }),
      ...(typeof raw.learnings === 'string' && { learnings: raw.learnings }),
      ...(commits && commits.length > 0 && { commits })
    })
  }

  return normalized
}

export function normalizeProgressFile(
  value: unknown,
  options: ProgressNormalizationOptions = {}
): ProgressFile {
  const now = options.now || new Date().toISOString()
  const parsed = progressInputSchema.safeParse(value)
  const input = parsed.success ? parsed.data : {}

  const prdName = input.prdName
    || options.prdNameFallback
    || 'Unknown PRD'

  const patterns = normalizePatterns(input.patterns)

  const taskLogs = input.taskLogs && input.taskLogs.length > 0
    ? normalizeTaskLogs(input.taskLogs, now)
    : normalizeLegacyTaskProgress(input.taskProgress, now)

  const completed = typeof input.completed === 'number'
    ? Math.max(0, Math.floor(input.completed))
    : (Array.isArray(input.completed) ? input.completed.length : taskLogs.filter((log) => log.status === 'completed').length)

  const inProgress = coerceNonNegativeNumber(input.inProgress)
    ?? taskLogs.filter((log) => log.status === 'in_progress').length

  const blocked = coerceNonNegativeNumber(input.blocked) ?? 0
  const totalTasks = coerceNonNegativeNumber(input.totalTasks)
    ?? coerceNonNegativeNumber(options.totalTasksHint)
    ?? Math.max(completed + inProgress + blocked, taskLogs.length)

  return progressFileSchema.parse({
    prdName,
    shortcutStory: undefined,
    totalTasks,
    completed,
    inProgress,
    blocked,
    startedAt: input.startedAt ?? input.started ?? null,
    lastUpdated: input.lastUpdated || now,
    patterns,
    taskLogs
  }) as ProgressFile
}

export function parseStoredProgressFile(
  value: unknown,
  options: ProgressNormalizationOptions = {}
): ProgressFile {
  return normalizeProgressFile(value, options)
}

export function needsProgressMigration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return true
  }

  const record = value as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, 'started')) {
    return true
  }

  if (Object.prototype.hasOwnProperty.call(record, 'taskProgress')) {
    return true
  }

  if (!Array.isArray(record.patterns) || !Array.isArray(record.taskLogs)) {
    return true
  }

  if (Array.isArray(record.completed)) {
    return true
  }

  if (record.inProgress === null) {
    return true
  }

  const result = progressFileSchema.safeParse(value)
  return !result.success
}

export function parseTasksFile(value: unknown): TasksFile {
  return tasksFileSchema.parse(value) as TasksFile
}

export function parseProgressFile(value: unknown): ProgressFile {
  return progressFileSchema.parse(value) as ProgressFile
}
