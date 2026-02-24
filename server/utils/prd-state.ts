import type { TasksFile, ProgressFile } from '../../app/types/task.js'
import { emitChange } from './change-events.js'
import { dbAll, dbGet, dbRun } from './db.js'
import { parseProgressFile, parseTasksFile } from './state-schema.js'

type PrdStateRow = {
  repo_id: string
  slug: string
  tasks_json: string | null
  progress_json: string | null
  notes_md: string | null
  updated_at: string
}

export type StoredPrdState = {
  slug: string
  tasks: TasksFile | null
  progress: ProgressFile | null
  notes: string | null
  updatedAt: string
}

export type PrdStateUpdate = {
  tasks?: TasksFile | null
  progress?: ProgressFile | null
  notes?: string | null
}

export type PrdStateSummary = {
  hasState: boolean
  taskCount?: number
  completedCount?: number
}

function parseStoredJson<T>(
  raw: string | null,
  fieldName: string,
  parseValue: (value: unknown) => T
): T | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return parseValue(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON stored in ${fieldName}: ${message}`)
  }
}

function getTaskCounts(tasksFile: TasksFile): { taskCount: number; completedCount: number } | null {
  if (!tasksFile || !Array.isArray(tasksFile.tasks)) {
    return null
  }

  const taskCount = tasksFile.tasks.length
  const completedCount = tasksFile.tasks.filter(task => task.status === 'completed').length
  return { taskCount, completedCount }
}

export async function getPrdState(repoId: string, slug: string): Promise<StoredPrdState | null> {
  const row = await dbGet<PrdStateRow>(
    `
      SELECT repo_id, slug, tasks_json, progress_json, notes_md, updated_at
      FROM prd_states
      WHERE repo_id = ? AND slug = ?
    `,
    [repoId, slug]
  )

  if (!row) {
    return null
  }

  const tasks = parseStoredJson<TasksFile>(
    row.tasks_json,
    'prd_states.tasks_json',
    parseTasksFile
  )
  const progress = parseStoredJson<ProgressFile>(
    row.progress_json,
    'prd_states.progress_json',
    parseProgressFile
  )

  return {
    slug: row.slug,
    tasks,
    progress,
    notes: row.notes_md,
    updatedAt: row.updated_at
  }
}

export async function getPrdStateSummaries(repoId: string): Promise<Map<string, PrdStateSummary>> {
  const rows = await dbAll<Pick<PrdStateRow, 'slug' | 'tasks_json'>>(
    'SELECT slug, tasks_json FROM prd_states WHERE repo_id = ?',
    [repoId]
  )

  const summaries = new Map<string, PrdStateSummary>()

  for (const row of rows) {
    const summary: PrdStateSummary = { hasState: true }

    if (row.tasks_json) {
      try {
        const tasksFile = parseTasksFile(JSON.parse(row.tasks_json) as unknown)
        const counts = getTaskCounts(tasksFile)
        if (counts) {
          summary.taskCount = counts.taskCount
          summary.completedCount = counts.completedCount
        }
      } catch {
        // Keep hasState=true and omit counts when JSON is malformed.
      }
    }

    summaries.set(row.slug, summary)
  }

  return summaries
}

export async function upsertPrdState(repoId: string, slug: string, update: PrdStateUpdate): Promise<void> {
  const validatedTasks = update.tasks === undefined
    ? undefined
    : (update.tasks === null ? null : parseTasksFile(update.tasks))

  const validatedProgress = update.progress === undefined
    ? undefined
    : (update.progress === null ? null : parseProgressFile(update.progress))

  const updateTasks = validatedTasks !== undefined
  const updateProgress = validatedProgress !== undefined
  const updateNotes = update.notes !== undefined

  const tasksJson = validatedTasks === undefined
    ? null
    : (validatedTasks === null ? null : JSON.stringify(validatedTasks))

  const progressJson = validatedProgress === undefined
    ? null
    : (validatedProgress === null ? null : JSON.stringify(validatedProgress))

  const notesMd = update.notes === undefined
    ? null
    : update.notes

  const updatedAt = new Date().toISOString()

  await dbRun(
    `
      INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_id, slug) DO UPDATE SET
        tasks_json = CASE WHEN ? THEN excluded.tasks_json ELSE prd_states.tasks_json END,
        progress_json = CASE WHEN ? THEN excluded.progress_json ELSE prd_states.progress_json END,
        notes_md = CASE WHEN ? THEN excluded.notes_md ELSE prd_states.notes_md END,
        updated_at = excluded.updated_at
    `,
    [
      repoId,
      slug,
      tasksJson,
      progressJson,
      notesMd,
      updatedAt,
      updateTasks ? 1 : 0,
      updateProgress ? 1 : 0,
      updateNotes ? 1 : 0
    ]
  )

  if (validatedTasks !== undefined) {
    emitChange({
      type: 'change',
      path: `state://${repoId}/${slug}/tasks.json`,
      repoId,
      category: 'tasks'
    })
  }

  if (validatedProgress !== undefined) {
    emitChange({
      type: 'change',
      path: `state://${repoId}/${slug}/progress.json`,
      repoId,
      category: 'progress'
    })
  }
}
