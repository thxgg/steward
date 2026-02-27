import type { CommitRef, ProgressFile } from '../../app/types/task.js'
import type { RepoConfig } from '../../app/types/repo.js'
import { emitChange } from './change-events.js'
import { dbAll, dbExec, dbGet, dbRun } from './db.js'
import { findRepoForCommit } from './git.js'
import { normalizeCommitRepoRefPath, normalizePathSlashes } from './git-repo-path.js'
import { getRepos } from './repos.js'
import { needsProgressMigration, parseStoredProgressFile, parseTasksFile } from './state-schema.js'

type MigrationState = 'idle' | 'running' | 'completed' | 'failed'

type PrdStateRow = {
  repo_id: string
  slug: string
  tasks_json: string | null
  progress_json: string | null
}

type MetaRow = {
  value: string
}

type MigrationMarker = {
  version: string
  completedAt: string
  totalRows: number
  migratedRows: number
}

type CommitRepoMigrationMarker = {
  version: string
  completedAt: string
  totalRows: number
  migratedRows: number
  unresolvedRefs: number
}

export type StateMigrationStatus = {
  state: MigrationState
  version: string
  startedAt: string | null
  completedAt: string | null
  totalRows: number
  processedRows: number
  migratedRows: number
  failedRows: number
  currentSlug: string | null
  errorMessage: string | null
  percent: number
}

const MIGRATION_VERSION = 'progress-json-v2'
const MIGRATION_META_KEY = `state-migration:${MIGRATION_VERSION}`
const COMMIT_REPO_MIGRATION_VERSION = 'commit-repo-ref-v1'
const COMMIT_REPO_MIGRATION_META_KEY = `state-migration:${COMMIT_REPO_MIGRATION_VERSION}`

let status: StateMigrationStatus = {
  state: 'idle',
  version: MIGRATION_VERSION,
  startedAt: null,
  completedAt: null,
  totalRows: 0,
  processedRows: 0,
  migratedRows: 0,
  failedRows: 0,
  currentSlug: null,
  errorMessage: null,
  percent: 0
}

let migrationPromise: Promise<void> | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function toPercent(processedRows: number, totalRows: number): number {
  if (totalRows <= 0) {
    return 100
  }

  return Math.min(100, Math.floor((processedRows / totalRows) * 100))
}

function resetRunningStatus(totalRows: number): void {
  status = {
    state: 'running',
    version: MIGRATION_VERSION,
    startedAt: nowIso(),
    completedAt: null,
    totalRows,
    processedRows: 0,
    migratedRows: 0,
    failedRows: 0,
    currentSlug: null,
    errorMessage: null,
    percent: totalRows === 0 ? 100 : 0
  }
}

function markCompleted(marker?: MigrationMarker): void {
  const completedAt = marker?.completedAt || nowIso()
  const totalRows = marker?.totalRows ?? status.totalRows
  const migratedRows = marker?.migratedRows ?? status.migratedRows

  status = {
    ...status,
    state: 'completed',
    completedAt,
    totalRows,
    processedRows: totalRows,
    migratedRows,
    failedRows: 0,
    currentSlug: null,
    errorMessage: null,
    percent: 100
  }
}

function markFailed(message: string): void {
  status = {
    ...status,
    state: 'failed',
    completedAt: nowIso(),
    currentSlug: null,
    errorMessage: message,
    percent: toPercent(status.processedRows, status.totalRows)
  }
}

async function ensureMetaTable(): Promise<void> {
  await dbExec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

async function readMigrationMarker(): Promise<MigrationMarker | null> {
  const row = await dbGet<MetaRow>(
    'SELECT value FROM app_meta WHERE key = ?',
    [MIGRATION_META_KEY]
  )

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as MigrationMarker
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    if (parsed.version !== MIGRATION_VERSION) {
      return null
    }

    if (typeof parsed.completedAt !== 'string') {
      return null
    }

    if (typeof parsed.totalRows !== 'number' || typeof parsed.migratedRows !== 'number') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function writeMigrationMarker(totalRows: number, migratedRows: number): Promise<void> {
  const completedAt = nowIso()
  const marker: MigrationMarker = {
    version: MIGRATION_VERSION,
    completedAt,
    totalRows,
    migratedRows
  }

  await dbRun(
    `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [MIGRATION_META_KEY, JSON.stringify(marker), completedAt]
  )
}

async function readCommitRepoMigrationMarker(): Promise<CommitRepoMigrationMarker | null> {
  const row = await dbGet<MetaRow>(
    'SELECT value FROM app_meta WHERE key = ?',
    [COMMIT_REPO_MIGRATION_META_KEY]
  )

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as CommitRepoMigrationMarker
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    if (parsed.version !== COMMIT_REPO_MIGRATION_VERSION) {
      return null
    }

    if (typeof parsed.completedAt !== 'string') {
      return null
    }

    if (
      typeof parsed.totalRows !== 'number'
      || typeof parsed.migratedRows !== 'number'
      || typeof parsed.unresolvedRefs !== 'number'
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function writeCommitRepoMigrationMarker(
  totalRows: number,
  migratedRows: number,
  unresolvedRefs: number
): Promise<void> {
  const completedAt = nowIso()
  const marker: CommitRepoMigrationMarker = {
    version: COMMIT_REPO_MIGRATION_VERSION,
    completedAt,
    totalRows,
    migratedRows,
    unresolvedRefs
  }

  await dbRun(
    `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [COMMIT_REPO_MIGRATION_META_KEY, JSON.stringify(marker), completedAt]
  )
}

async function migrateProgressRows(): Promise<void> {
  await ensureMetaTable()

  const marker = await readMigrationMarker()
  if (marker) {
    markCompleted(marker)
    return
  }

  const rows = await dbAll<PrdStateRow>(
    `
      SELECT repo_id, slug, tasks_json, progress_json
      FROM prd_states
      WHERE progress_json IS NOT NULL
      ORDER BY repo_id ASC, slug ASC
    `
  )

  resetRunningStatus(rows.length)

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    status.currentSlug = row.slug

    try {
      const parsedProgress = row.progress_json
        ? (JSON.parse(row.progress_json) as unknown)
        : null

      let tasksCountHint: number | undefined
      let prdNameFallback: string | undefined

      if (row.tasks_json) {
        try {
          const tasks = parseTasksFile(JSON.parse(row.tasks_json) as unknown)
          tasksCountHint = tasks.tasks.length
          prdNameFallback = tasks.prd.name
        } catch {
          // Keep fallback below when tasks_json is malformed.
        }
      }

      const shouldMigrate = needsProgressMigration(parsedProgress)

      if (shouldMigrate) {
        const normalized = parseStoredProgressFile(parsedProgress, {
          prdNameFallback: prdNameFallback || row.slug,
          totalTasksHint: tasksCountHint
        })

        const updatedAt = nowIso()
        await dbRun(
          `
            UPDATE prd_states
            SET progress_json = ?, progress_updated_at = ?, updated_at = ?
            WHERE repo_id = ? AND slug = ?
          `,
          [JSON.stringify(normalized), updatedAt, updatedAt, row.repo_id, row.slug]
        )

        status.migratedRows += 1

        emitChange({
          type: 'change',
          path: `state://${row.repo_id}/${row.slug}/progress.json`,
          repoId: row.repo_id,
          category: 'progress'
        })
      }
    } catch {
      status.failedRows += 1
    }

    status.processedRows = index + 1
    status.percent = toPercent(status.processedRows, status.totalRows)
  }

  if (status.failedRows > 0) {
    markFailed(`Failed to migrate ${status.failedRows} PRD progress row(s).`)
    return
  }

  await writeMigrationMarker(status.totalRows, status.migratedRows)
  markCompleted()
}

function getKnownGitRepoPaths(repo: RepoConfig): Set<string> {
  const known = new Set<string>()

  for (const gitRepo of repo.gitRepos || []) {
    known.add(normalizePathSlashes(gitRepo.relativePath))
  }

  return known
}

async function normalizeTaskLogCommitRepos(
  repo: RepoConfig,
  taskLogs: ProgressFile['taskLogs']
): Promise<{
  taskLogs: ProgressFile['taskLogs']
  changed: boolean
  unresolvedRefs: number
}> {
  const knownRepoPaths = getKnownGitRepoPaths(repo)
  let changed = false
  let unresolvedRefs = 0
  const normalizedLogs: ProgressFile['taskLogs'] = []

  for (const taskLog of taskLogs) {
    if (!Array.isArray(taskLog.commits) || taskLog.commits.length === 0) {
      normalizedLogs.push(taskLog)
      continue
    }

    let taskLogChanged = false
    const normalizedCommits: (string | CommitRef)[] = []

    for (const commitEntry of taskLog.commits) {
      if (typeof commitEntry === 'string') {
        normalizedCommits.push(commitEntry)
        continue
      }

      const normalizedRepoPath = normalizeCommitRepoRefPath(repo, commitEntry.repo)

      if (normalizedRepoPath !== null) {
        let canonicalRepoPath = normalizedRepoPath

        if (canonicalRepoPath !== '' && !knownRepoPaths.has(canonicalRepoPath)) {
          try {
            const resolved = await findRepoForCommit(repo, commitEntry.sha)
            canonicalRepoPath = resolved.repoPath
          } catch {
            // Keep normalized repo path for unknown/untracked nested repos.
          }
        }

        if (canonicalRepoPath !== commitEntry.repo) {
          changed = true
          taskLogChanged = true
          normalizedCommits.push({
            sha: commitEntry.sha,
            repo: canonicalRepoPath
          })
        } else {
          normalizedCommits.push(commitEntry)
        }

        continue
      }

      try {
        const resolved = await findRepoForCommit(repo, commitEntry.sha)
        changed = true
        taskLogChanged = true
        normalizedCommits.push({
          sha: commitEntry.sha,
          repo: resolved.repoPath
        })
      } catch {
        unresolvedRefs += 1
        normalizedCommits.push(commitEntry)
      }
    }

    if (taskLogChanged) {
      normalizedLogs.push({
        ...taskLog,
        commits: normalizedCommits
      })
    } else {
      normalizedLogs.push(taskLog)
    }
  }

  return {
    taskLogs: normalizedLogs,
    changed,
    unresolvedRefs
  }
}

async function migrateCommitRepoRefs(): Promise<void> {
  await ensureMetaTable()

  const marker = await readCommitRepoMigrationMarker()
  if (marker) {
    return
  }

  const [rows, repos] = await Promise.all([
    dbAll<PrdStateRow>(
      `
        SELECT repo_id, slug, tasks_json, progress_json
        FROM prd_states
        WHERE progress_json IS NOT NULL
        ORDER BY repo_id ASC, slug ASC
      `
    ),
    getRepos()
  ])

  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  let migratedRows = 0
  let unresolvedRefs = 0

  for (const row of rows) {
    const repo = repoById.get(row.repo_id)
    if (!repo || !row.progress_json) {
      continue
    }

    try {
      const parsedProgress = JSON.parse(row.progress_json) as unknown

      let tasksCountHint: number | undefined
      let prdNameFallback: string | undefined

      if (row.tasks_json) {
        try {
          const tasks = parseTasksFile(JSON.parse(row.tasks_json) as unknown)
          tasksCountHint = tasks.tasks.length
          prdNameFallback = tasks.prd.name
        } catch {
          // Keep fallback below when tasks_json is malformed.
        }
      }

      const progress = parseStoredProgressFile(parsedProgress, {
        prdNameFallback: prdNameFallback || row.slug,
        totalTasksHint: tasksCountHint
      })

      const normalized = await normalizeTaskLogCommitRepos(repo, progress.taskLogs)
      unresolvedRefs += normalized.unresolvedRefs

      if (!normalized.changed) {
        continue
      }

      const updatedAt = nowIso()
      await dbRun(
        `
          UPDATE prd_states
          SET progress_json = ?, progress_updated_at = ?, updated_at = ?
          WHERE repo_id = ? AND slug = ?
        `,
        [
          JSON.stringify({
            ...progress,
            taskLogs: normalized.taskLogs
          }),
          updatedAt,
          updatedAt,
          row.repo_id,
          row.slug
        ]
      )

      migratedRows += 1

      emitChange({
        type: 'change',
        path: `state://${row.repo_id}/${row.slug}/progress.json`,
        repoId: row.repo_id,
        category: 'progress'
      })
    } catch {
      // Ignore malformed rows; they remain untouched.
    }
  }

  await writeCommitRepoMigrationMarker(rows.length, migratedRows, unresolvedRefs)
}

async function runMigration(): Promise<void> {
  try {
    await migrateProgressRows()

    if (status.state === 'failed') {
      return
    }

    await migrateCommitRepoRefs()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markFailed(message)
  }
}

export function getStateMigrationStatus(): StateMigrationStatus {
  return { ...status }
}

export function startStateMigration(): Promise<void> {
  if (!migrationPromise) {
    if (status.state === 'idle') {
      status = {
        ...status,
        state: 'running',
        startedAt: nowIso(),
        completedAt: null,
        errorMessage: null,
        percent: 0
      }
    }

    migrationPromise = runMigration().finally(() => {
      migrationPromise = null
    })
  }

  return migrationPromise
}

export async function ensureStateMigrationReady(): Promise<void> {
  if (status.state !== 'completed') {
    await startStateMigration()
  }

  if (status.state === 'failed') {
    throw new Error(status.errorMessage || 'State migration failed')
  }
}
