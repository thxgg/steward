import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { dbExec, dbGet, dbRun, getDbPath } from './db.js'
import {
  planSyncMerge,
  type SyncArchiveMergePlanRow,
  type SyncMergePlan,
  type SyncMergePlanOptions,
  type SyncStateMergePlanRow
} from './sync-merge.js'
import { parseSyncBundle, type SyncArchiveRecord, type SyncBundle, type SyncStateRecord } from './sync-schema.js'

const DEFAULT_BACKUP_RETENTION_DAYS = 30
const DEFAULT_MAX_BACKUPS = 20
const DEFAULT_LOG_RETENTION_DAYS = 180
const DEFAULT_MAX_LOG_ENTRIES = 10_000

type SyncLogRow = {
  bundle_id: string
  applied_at: string
}

export type ApplySyncMergeOptions = SyncMergePlanOptions & {
  apply?: boolean
  now?: string
  backupRetentionDays?: number
  maxBackups?: number
  logRetentionDays?: number
  maxLogEntries?: number
}

export type ApplySyncMergeResult = {
  mode: 'dry_run' | 'apply'
  applied: boolean
  alreadyApplied: boolean
  bundleId: string
  plan: SyncMergePlan
  backupPath?: string
  retention: {
    backupsDeleted: number
    logsDeleted: number
  }
}

type RetentionPolicy = {
  backupRetentionDays: number
  maxBackups: number
  logRetentionDays: number
  maxLogEntries: number
}

function sanitizeRetentionNumber(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.floor(value))
}

function resolveRetentionPolicy(options: ApplySyncMergeOptions): RetentionPolicy {
  return {
    backupRetentionDays: sanitizeRetentionNumber(options.backupRetentionDays, DEFAULT_BACKUP_RETENTION_DAYS, 0),
    maxBackups: sanitizeRetentionNumber(options.maxBackups, DEFAULT_MAX_BACKUPS, 1),
    logRetentionDays: sanitizeRetentionNumber(options.logRetentionDays, DEFAULT_LOG_RETENTION_DAYS, 0),
    maxLogEntries: sanitizeRetentionNumber(options.maxLogEntries, DEFAULT_MAX_LOG_ENTRIES, 1)
  }
}

function toStateKey(repoSyncKey: string, slug: string): string {
  return `${repoSyncKey}:${slug}`
}

function serializeJson(value: unknown | null): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return JSON.stringify(value)
}

function parseIsoOrNow(value: string | undefined): string {
  if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }

  return new Date().toISOString()
}

function escapeSqliteString(value: string): string {
  return value.replaceAll("'", "''")
}

function toBackupFileTimestamp(nowIso: string): string {
  return nowIso
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replaceAll('.', '')
}

function toSafeFileSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'bundle'
}

function getBackupFilePrefix(dbPath: string): string {
  return `${basename(dbPath)}.sync-backup.`
}

async function createDatabaseBackup(bundleId: string, nowIso: string): Promise<string> {
  const dbPath = getDbPath()
  const backupDir = dirname(dbPath)
  const filePrefix = getBackupFilePrefix(dbPath)
  const fileName = `${filePrefix}${toBackupFileTimestamp(nowIso)}-${toSafeFileSegment(bundleId)}-${randomUUID().slice(0, 8)}.db`
  const backupPath = join(backupDir, fileName)

  await fs.mkdir(backupDir, { recursive: true })
  await dbExec(`VACUUM INTO '${escapeSqliteString(backupPath)}';`)

  return backupPath
}

async function pruneDatabaseBackups(nowIso: string, policy: RetentionPolicy): Promise<number> {
  const dbPath = getDbPath()
  const backupDir = dirname(dbPath)
  const filePrefix = getBackupFilePrefix(dbPath)
  const cutoffMs = Date.parse(nowIso) - (policy.backupRetentionDays * 24 * 60 * 60 * 1000)

  let entries: Array<{ path: string; mtimeMs: number }> = []

  try {
    const dirEntries = await fs.readdir(backupDir, { withFileTypes: true })
    const candidateFiles = dirEntries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(filePrefix) && name.endsWith('.db'))

    entries = await Promise.all(candidateFiles.map(async (name) => {
      const filePath = join(backupDir, name)
      const stat = await fs.stat(filePath)
      return {
        path: filePath,
        mtimeMs: stat.mtimeMs
      }
    }))
  } catch {
    return 0
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)

  let deleted = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const tooOld = Number.isFinite(cutoffMs) ? entry.mtimeMs < cutoffMs : false
    const overLimit = index >= policy.maxBackups

    if (!tooOld && !overLimit) {
      continue
    }

    try {
      await fs.unlink(entry.path)
      deleted += 1
    } catch {
      // Ignore retention cleanup errors; merge apply already succeeded.
    }
  }

  return deleted
}

async function pruneSyncLog(nowIso: string, policy: RetentionPolicy): Promise<number> {
  const cutoffIso = new Date(Date.parse(nowIso) - (policy.logRetentionDays * 24 * 60 * 60 * 1000)).toISOString()

  let deleted = 0
  const deleteOlder = await dbRun(
    'DELETE FROM sync_bundle_log WHERE applied_at < ?',
    [cutoffIso]
  )
  deleted += deleteOlder.changes

  const countRow = await dbGet<{ count: number }>(
    'SELECT COUNT(*) as count FROM sync_bundle_log'
  )

  const currentCount = countRow?.count ?? 0
  if (currentCount <= policy.maxLogEntries) {
    return deleted
  }

  const toDeleteCount = currentCount - policy.maxLogEntries
  if (toDeleteCount <= 0) {
    return deleted
  }

  const deleteOverflow = await dbRun(
    `
      DELETE FROM sync_bundle_log
      WHERE bundle_id IN (
        SELECT bundle_id
        FROM sync_bundle_log
        ORDER BY applied_at ASC, bundle_id ASC
        LIMIT ?
      )
    `,
    [toDeleteCount]
  )

  deleted += deleteOverflow.changes
  return deleted
}

function assertNoUnresolvedMappings(plan: SyncMergePlan): void {
  const unresolvedMappings = plan.mappings.filter((mapping) => mapping.source === 'unresolved')
  if (unresolvedMappings.length === 0) {
    return
  }

  const unresolvedKeys = unresolvedMappings.map((mapping) => mapping.incomingRepoSyncKey).join(', ')
  throw new Error(`Cannot apply bundle with unresolved repositories: ${unresolvedKeys}`)
}

async function applyStateInsert(planRow: SyncStateMergePlanRow, incomingRow: SyncStateRecord, appliedAt: string): Promise<void> {
  if (!planRow.localRepoId) {
    throw new Error(`Missing local repository mapping for ${planRow.repoSyncKey}`)
  }

  await dbRun(
    `
      INSERT INTO prd_states (
        repo_id,
        slug,
        tasks_json,
        progress_json,
        notes_md,
        tasks_updated_at,
        progress_updated_at,
        notes_updated_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_id, slug) DO UPDATE SET
        tasks_json = excluded.tasks_json,
        progress_json = excluded.progress_json,
        notes_md = excluded.notes_md,
        tasks_updated_at = excluded.tasks_updated_at,
        progress_updated_at = excluded.progress_updated_at,
        notes_updated_at = excluded.notes_updated_at,
        updated_at = excluded.updated_at
    `,
    [
      planRow.localRepoId,
      incomingRow.slug,
      serializeJson(incomingRow.tasks),
      serializeJson(incomingRow.progress),
      incomingRow.notes,
      incomingRow.clocks.tasksUpdatedAt,
      incomingRow.clocks.progressUpdatedAt,
      incomingRow.clocks.notesUpdatedAt,
      appliedAt
    ]
  )
}

async function applyStateUpdate(planRow: SyncStateMergePlanRow, incomingRow: SyncStateRecord, appliedAt: string): Promise<void> {
  if (!planRow.localRepoId) {
    throw new Error(`Missing local repository mapping for ${planRow.repoSyncKey}`)
  }

  const updateTasks = planRow.updateFields.includes('tasks')
  const updateProgress = planRow.updateFields.includes('progress')
  const updateNotes = planRow.updateFields.includes('notes')
  const anyUpdate = updateTasks || updateProgress || updateNotes

  if (!anyUpdate) {
    return
  }

  const result = await dbRun(
    `
      UPDATE prd_states
      SET
        tasks_json = CASE WHEN ? THEN ? ELSE tasks_json END,
        progress_json = CASE WHEN ? THEN ? ELSE progress_json END,
        notes_md = CASE WHEN ? THEN ? ELSE notes_md END,
        tasks_updated_at = CASE WHEN ? THEN ? ELSE tasks_updated_at END,
        progress_updated_at = CASE WHEN ? THEN ? ELSE progress_updated_at END,
        notes_updated_at = CASE WHEN ? THEN ? ELSE notes_updated_at END,
        updated_at = CASE WHEN ? THEN ? ELSE updated_at END
      WHERE repo_id = ? AND slug = ?
    `,
    [
      updateTasks ? 1 : 0,
      serializeJson(incomingRow.tasks),
      updateProgress ? 1 : 0,
      serializeJson(incomingRow.progress),
      updateNotes ? 1 : 0,
      incomingRow.notes,
      updateTasks ? 1 : 0,
      incomingRow.clocks.tasksUpdatedAt,
      updateProgress ? 1 : 0,
      incomingRow.clocks.progressUpdatedAt,
      updateNotes ? 1 : 0,
      incomingRow.clocks.notesUpdatedAt,
      anyUpdate ? 1 : 0,
      appliedAt,
      planRow.localRepoId,
      incomingRow.slug
    ]
  )

  if (result.changes > 0) {
    return
  }

  await applyStateInsert(planRow, incomingRow, appliedAt)
}

async function applyArchiveAction(planRow: SyncArchiveMergePlanRow, incomingRow: SyncArchiveRecord): Promise<void> {
  if (!planRow.localRepoId) {
    throw new Error(`Missing local repository mapping for ${planRow.repoSyncKey}`)
  }

  if (planRow.action === 'insert') {
    await dbRun(
      `
        INSERT INTO prd_archives (repo_id, slug, archived_at)
        VALUES (?, ?, ?)
        ON CONFLICT(repo_id, slug) DO UPDATE SET
          archived_at = CASE
            WHEN excluded.archived_at > prd_archives.archived_at THEN excluded.archived_at
            ELSE prd_archives.archived_at
          END
      `,
      [planRow.localRepoId, incomingRow.slug, incomingRow.archivedAt]
    )
    return
  }

  if (planRow.action === 'update') {
    await dbRun(
      `
        UPDATE prd_archives
        SET archived_at = ?
        WHERE repo_id = ? AND slug = ? AND archived_at < ?
      `,
      [incomingRow.archivedAt, planRow.localRepoId, incomingRow.slug, incomingRow.archivedAt]
    )
  }
}

async function assertIntegrityCheckPasses(): Promise<void> {
  const row = await dbGet<Record<string, unknown>>('PRAGMA integrity_check')
  if (!row) {
    throw new Error('SQLite integrity check returned no results')
  }

  const firstValue = Object.values(row)[0]
  if (firstValue !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${String(firstValue)}`)
  }
}

async function hasBundleBeenApplied(bundleId: string): Promise<SyncLogRow | null> {
  return await dbGet<SyncLogRow>(
    'SELECT bundle_id, applied_at FROM sync_bundle_log WHERE bundle_id = ?',
    [bundleId]
  )
}

export async function executeSyncMerge(bundleInput: unknown, options: ApplySyncMergeOptions = {}): Promise<ApplySyncMergeResult> {
  const bundle: SyncBundle = parseSyncBundle(bundleInput)
  const nowIso = parseIsoOrNow(options.now)
  const retentionPolicy = resolveRetentionPolicy(options)

  const plan = await planSyncMerge(bundle, {
    repoMap: options.repoMap
  })

  if (options.apply !== true) {
    return {
      mode: 'dry_run',
      applied: false,
      alreadyApplied: false,
      bundleId: bundle.bundleId,
      plan,
      retention: {
        backupsDeleted: 0,
        logsDeleted: 0
      }
    }
  }

  const existingLog = await hasBundleBeenApplied(bundle.bundleId)
  if (existingLog) {
    return {
      mode: 'apply',
      applied: false,
      alreadyApplied: true,
      bundleId: bundle.bundleId,
      plan,
      retention: {
        backupsDeleted: 0,
        logsDeleted: 0
      }
    }
  }

  assertNoUnresolvedMappings(plan)

  const backupPath = await createDatabaseBackup(bundle.bundleId, nowIso)
  const incomingStateByKey = new Map<string, SyncStateRecord>()
  const incomingArchiveByKey = new Map<string, SyncArchiveRecord>()

  for (const row of bundle.states) {
    incomingStateByKey.set(toStateKey(row.repoSyncKey, row.slug), row)
  }

  for (const row of bundle.archives) {
    incomingArchiveByKey.set(toStateKey(row.repoSyncKey, row.slug), row)
  }

  let logsDeleted = 0
  let inTransaction = false

  try {
    await dbExec('BEGIN IMMEDIATE')
    inTransaction = true

    for (const planRow of plan.states) {
      if (planRow.action === 'skip' || planRow.action === 'unresolved') {
        continue
      }

      const incoming = incomingStateByKey.get(toStateKey(planRow.repoSyncKey, planRow.slug))
      if (!incoming) {
        throw new Error(`Missing incoming state row for ${planRow.repoSyncKey}:${planRow.slug}`)
      }

      if (planRow.action === 'insert') {
        await applyStateInsert(planRow, incoming, nowIso)
      } else {
        await applyStateUpdate(planRow, incoming, nowIso)
      }
    }

    for (const planRow of plan.archives) {
      if (planRow.action === 'skip' || planRow.action === 'unresolved') {
        continue
      }

      const incoming = incomingArchiveByKey.get(toStateKey(planRow.repoSyncKey, planRow.slug))
      if (!incoming) {
        throw new Error(`Missing incoming archive row for ${planRow.repoSyncKey}:${planRow.slug}`)
      }

      await applyArchiveAction(planRow, incoming)
    }

    await assertIntegrityCheckPasses()

    await dbRun(
      `
        INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json)
        VALUES (?, ?, ?, ?)
      `,
      [bundle.bundleId, bundle.sourceDeviceId, nowIso, JSON.stringify(plan.summary)]
    )

    logsDeleted = await pruneSyncLog(nowIso, retentionPolicy)

    await dbExec('COMMIT')
    inTransaction = false
  } catch (error) {
    if (inTransaction) {
      try {
        await dbExec('ROLLBACK')
      } catch {
        // Ignore rollback failure; original error is surfaced.
      }
    }

    throw error
  }

  const backupsDeleted = await pruneDatabaseBackups(nowIso, retentionPolicy)

  return {
    mode: 'apply',
    applied: true,
    alreadyApplied: false,
    bundleId: bundle.bundleId,
    plan,
    backupPath,
    retention: {
      backupsDeleted,
      logsDeleted
    }
  }
}

export async function executeSyncMergeJson(jsonPayload: string, options: ApplySyncMergeOptions = {}): Promise<ApplySyncMergeResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonPayload) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid bundle JSON: ${message}`)
  }

  return await executeSyncMerge(parsed, options)
}
