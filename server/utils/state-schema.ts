import { z } from 'zod'
import type { ProgressFile, TasksFile } from '../../app/types/task.js'

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
const taskCategorySchema = z.enum(['setup', 'feature', 'integration', 'testing', 'documentation'])
const taskPrioritySchema = z.enum(['critical', 'high', 'medium', 'low'])

const commitRefSchema = z.object({
  sha: z.string().min(1),
  repo: z.string()
})

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

const progressFileSchema = z.object({
  prdName: z.string(),
  shortcutStory: z.string().optional(),
  totalTasks: z.number(),
  completed: z.number(),
  inProgress: z.number(),
  blocked: z.number(),
  startedAt: z.string().nullable(),
  lastUpdated: z.string(),
  patterns: z.array(z.object({
    name: z.string(),
    description: z.string()
  })),
  taskLogs: z.array(taskLogSchema)
})

export function parseTasksFile(value: unknown): TasksFile {
  return tasksFileSchema.parse(value) as TasksFile
}

export function parseProgressFile(value: unknown): ProgressFile {
  return progressFileSchema.parse(value) as ProgressFile
}
