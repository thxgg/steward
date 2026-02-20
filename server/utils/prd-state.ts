import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RepoConfig } from '~/types/repo'
import type { TasksFile, ProgressFile } from '~/types/task'
import { dbAll, dbGet, dbRun } from './db'

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

const LEGACY_STATE_STABLE_MS = 0
const migrationInFlight = new Map<string, Promise<void>>()
const cleanupCompletedRepoIds = new Set<string>()

function parseStoredJson<T>(raw: string | null, fieldName: string): T | null {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
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

function normalizeLegacyTasksFile(tasksFile: TasksFile | null): TasksFile | null {
  if (!tasksFile || !Array.isArray(tasksFile.tasks)) {
    return tasksFile
  }

  const tasks = tasksFile.tasks.map((task) => {
    const passes = (task as { passes?: unknown }).passes
    if (Array.isArray(passes)) {
      return task
    }

    return {
      ...task,
      passes: []
    }
  })

  return {
    ...tasksFile,
    tasks
  }
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

  const tasks = normalizeLegacyTasksFile(parseStoredJson<TasksFile>(row.tasks_json, 'prd_states.tasks_json'))

  return {
    slug: row.slug,
    tasks,
    progress: parseStoredJson<ProgressFile>(row.progress_json, 'prd_states.progress_json'),
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
        const tasksFile = JSON.parse(row.tasks_json) as TasksFile
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
  const existing = await dbGet<PrdStateRow>(
    `
      SELECT repo_id, slug, tasks_json, progress_json, notes_md, updated_at
      FROM prd_states
      WHERE repo_id = ? AND slug = ?
    `,
    [repoId, slug]
  )

  const tasksJson = update.tasks === undefined
    ? existing?.tasks_json ?? null
    : (update.tasks === null ? null : JSON.stringify(update.tasks))

  const progressJson = update.progress === undefined
    ? existing?.progress_json ?? null
    : (update.progress === null ? null : JSON.stringify(update.progress))

  const notesMd = update.notes === undefined
    ? existing?.notes_md ?? null
    : update.notes

  const updatedAt = new Date().toISOString()

  if (existing) {
    await dbRun(
      `
        UPDATE prd_states
        SET tasks_json = ?, progress_json = ?, notes_md = ?, updated_at = ?
        WHERE repo_id = ? AND slug = ?
      `,
      [tasksJson, progressJson, notesMd, updatedAt, repoId, slug]
    )
    return
  }

  await dbRun(
    `
      INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [repoId, slug, tasksJson, progressJson, notesMd, updatedAt]
  )
}

type LegacyJsonReadResult<T> = {
  value: T | null
  imported: boolean
}

async function readStableLegacyFile(filePath: string, minFileAgeMs: number): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return null
    }

    if (Date.now() - stats.mtimeMs < minFileAgeMs) {
      return null
    }

    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function readLegacyJsonFile<T>(
  filePath: string,
  label: string,
  minFileAgeMs: number
): Promise<LegacyJsonReadResult<T>> {
  const content = await readStableLegacyFile(filePath, minFileAgeMs)
  if (!content) {
    return { value: null, imported: false }
  }

  try {
    return { value: JSON.parse(content) as T, imported: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[legacy-state] Skipping invalid ${label} at ${filePath}: ${message}`)
    return { value: null, imported: false }
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // File may already be removed.
  }
}

async function removeDirIfEmpty(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath)
    if (entries.length === 0) {
      await fs.rmdir(dirPath)
    }
  } catch {
    // Directory may not exist or may contain files.
  }
}

async function runLegacyStateMigration(
  repo: RepoConfig,
  cleanupLegacyFiles: boolean,
  minFileAgeMs: number
): Promise<void> {
  const legacyStateDir = join(repo.path, '.claude', 'state')

  const entries = await fs.readdir(legacyStateDir, { withFileTypes: true, encoding: 'utf8' }).catch(() => null)
  if (!entries) {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const slug = entry.name
    const slugDir = join(legacyStateDir, slug)
    const tasksPath = join(slugDir, 'tasks.json')
    const progressPath = join(slugDir, 'progress.json')
    const notesPath = join(slugDir, 'notes.md')

    const [tasksResult, progressResult, notesContent] = await Promise.all([
      readLegacyJsonFile<TasksFile>(tasksPath, 'tasks.json', minFileAgeMs),
      readLegacyJsonFile<ProgressFile>(progressPath, 'progress.json', minFileAgeMs),
      readStableLegacyFile(notesPath, minFileAgeMs)
    ])

    const shouldImportNotes = notesContent !== null
    const shouldImport = tasksResult.imported || progressResult.imported || shouldImportNotes

    if (!shouldImport) {
      continue
    }

    await upsertPrdState(repo.id, slug, {
      ...(tasksResult.imported && { tasks: tasksResult.value }),
      ...(progressResult.imported && { progress: progressResult.value }),
      ...(shouldImportNotes && { notes: notesContent })
    })

    if (cleanupLegacyFiles) {
      if (tasksResult.imported) {
        await removeIfExists(tasksPath)
      }

      if (progressResult.imported) {
        await removeIfExists(progressPath)
      }

      if (shouldImportNotes) {
        await removeIfExists(notesPath)
      }

      await removeDirIfEmpty(slugDir)
    }
  }

  if (cleanupLegacyFiles) {
    await removeDirIfEmpty(legacyStateDir)
  }
}

export async function migrateLegacyStateForRepo(
  repo: RepoConfig,
  options: { cleanupLegacyFiles?: boolean; minFileAgeMs?: number } = {}
): Promise<void> {
  const cleanupLegacyFiles = options.cleanupLegacyFiles
    ?? !cleanupCompletedRepoIds.has(repo.id)
  const minFileAgeMs = options.minFileAgeMs ?? LEGACY_STATE_STABLE_MS

  const inFlight = migrationInFlight.get(repo.id)
  if (inFlight) {
    return inFlight
  }

  const migrationPromise = runLegacyStateMigration(repo, cleanupLegacyFiles, minFileAgeMs)
    .then(() => {
      if (cleanupLegacyFiles) {
        cleanupCompletedRepoIds.add(repo.id)
      }
    })
    .finally(() => {
      migrationInFlight.delete(repo.id)
    })

  migrationInFlight.set(repo.id, migrationPromise)
  return migrationPromise
}
