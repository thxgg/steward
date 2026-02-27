import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProgressFile, TasksFile } from '../../app/types/task.js'
import { dbAll } from './db.js'
import { getRepos } from './repos.js'
import {
  createSyncFieldHashes,
  parseSyncBundle,
  type SyncArchiveRecord,
  type SyncBundle,
  type SyncStateRecord
} from './sync-schema.js'
import { ensureRepoSyncMetaForRepos, getOrCreateSyncDeviceId } from './sync-identity.js'
import { parseStoredProgressFile, parseTasksFile } from './state-schema.js'

export type SyncPathHintsMode = 'basename' | 'none' | 'absolute'

export type BuildSyncBundleOptions = {
  pathHints?: SyncPathHintsMode
  repoIds?: string[]
  createdAt?: string
  bundleId?: string
  stewardVersion?: string
}

type PrdStateExportRow = {
  repo_id: string
  slug: string
  tasks_json: string | null
  progress_json: string | null
  notes_md: string | null
  updated_at: string
  tasks_updated_at: string | null
  progress_updated_at: string | null
  notes_updated_at: string | null
}

type PrdArchiveExportRow = {
  repo_id: string
  slug: string
  archived_at: string
}

function parseStoredJson<T>(
  rawValue: string | null,
  fieldName: string,
  parseValue: (value: unknown) => T
): T | null {
  if (!rawValue) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawValue) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON stored in ${fieldName}: ${message}`)
  }

  return parseValue(parsed)
}

function resolvePathHint(path: string, mode: SyncPathHintsMode): string | undefined {
  if (mode === 'none') {
    return undefined
  }

  if (mode === 'absolute') {
    return resolve(path)
  }

  return basename(resolve(path))
}

function toClockValue(primary: string | null, fallback: string | null, hasValue: boolean): string | null {
  if (primary) {
    return primary
  }

  if (hasValue) {
    return fallback
  }

  return null
}

function findPackageRoot(startDir: string): string {
  let currentDir = startDir

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      return currentDir
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return startDir
    }

    currentDir = parentDir
  }
}

async function readStewardVersion(): Promise<string> {
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)))
  const packageJsonPath = join(packageRoot, 'package.json')

  try {
    const contents = await fs.readFile(packageJsonPath, 'utf-8')
    const parsed = JSON.parse(contents) as { version?: unknown }
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version
    }
  } catch {
    // Fall back to unknown when package metadata cannot be loaded.
  }

  return 'unknown'
}

export async function buildSyncBundle(options: BuildSyncBundleOptions = {}): Promise<SyncBundle> {
  const pathHintsMode: SyncPathHintsMode = options.pathHints || 'basename'
  const createdAt = options.createdAt || new Date().toISOString()

  const [allRepos, sourceDeviceId, stewardVersion] = await Promise.all([
    getRepos(),
    getOrCreateSyncDeviceId(),
    options.stewardVersion ? Promise.resolve(options.stewardVersion) : readStewardVersion()
  ])

  const filteredRepoIds = new Set(
    Array.isArray(options.repoIds)
      ? options.repoIds.filter((repoId): repoId is string => typeof repoId === 'string' && repoId.trim().length > 0)
      : []
  )

  const repos = filteredRepoIds.size > 0
    ? allRepos.filter((repo) => filteredRepoIds.has(repo.id))
    : allRepos

  const repoMetaById = await ensureRepoSyncMetaForRepos(repos)
  const repoIds = repos.map((repo) => repo.id)

  let stateRows: PrdStateExportRow[] = []
  let archiveRows: PrdArchiveExportRow[] = []

  if (repoIds.length > 0) {
    const placeholders = repoIds.map(() => '?').join(', ')

    stateRows = await dbAll<PrdStateExportRow>(
      `
        SELECT
          repo_id,
          slug,
          tasks_json,
          progress_json,
          notes_md,
          updated_at,
          tasks_updated_at,
          progress_updated_at,
          notes_updated_at
        FROM prd_states
        WHERE repo_id IN (${placeholders})
        ORDER BY repo_id ASC, slug ASC
      `,
      repoIds
    )

    archiveRows = await dbAll<PrdArchiveExportRow>(
      `
        SELECT repo_id, slug, archived_at
        FROM prd_archives
        WHERE repo_id IN (${placeholders})
        ORDER BY repo_id ASC, slug ASC
      `,
      repoIds
    )
  }

  const syncRepos = repos.map((repo) => {
    const repoMeta = repoMetaById.get(repo.id)
    if (!repoMeta) {
      throw new Error(`Missing sync metadata for repository ${repo.id}`)
    }

    const pathHint = resolvePathHint(repo.path, pathHintsMode)

    return {
      repoSyncKey: repoMeta.syncKey,
      name: repo.name,
      ...(pathHint && { pathHint }),
      fingerprint: repoMeta.fingerprint,
      fingerprintKind: repoMeta.fingerprintKind
    }
  })

  const states: SyncStateRecord[] = stateRows.map((row) => {
    const repoMeta = repoMetaById.get(row.repo_id)
    if (!repoMeta) {
      throw new Error(`Missing sync metadata for repository ${row.repo_id}`)
    }

    const tasks = parseStoredJson<TasksFile>(
      row.tasks_json,
      'prd_states.tasks_json',
      parseTasksFile
    )

    const progress = parseStoredJson<ProgressFile>(
      row.progress_json,
      'prd_states.progress_json',
      (value) => parseStoredProgressFile(value, {
        totalTasksHint: Array.isArray(tasks?.tasks) ? tasks.tasks.length : undefined,
        prdNameFallback: tasks?.prd?.name || row.slug
      })
    )

    const clocks = {
      tasksUpdatedAt: toClockValue(row.tasks_updated_at, row.updated_at, tasks !== null),
      progressUpdatedAt: toClockValue(row.progress_updated_at, row.updated_at, progress !== null),
      notesUpdatedAt: toClockValue(row.notes_updated_at, row.updated_at, row.notes_md !== null)
    }

    const hashes = createSyncFieldHashes({
      tasks,
      progress,
      notes: row.notes_md
    })

    return {
      repoSyncKey: repoMeta.syncKey,
      slug: row.slug,
      tasks,
      progress,
      notes: row.notes_md,
      clocks,
      hashes
    }
  })

  const archives: SyncArchiveRecord[] = archiveRows.map((row) => {
    const repoMeta = repoMetaById.get(row.repo_id)
    if (!repoMeta) {
      throw new Error(`Missing sync metadata for repository ${row.repo_id}`)
    }

    return {
      repoSyncKey: repoMeta.syncKey,
      slug: row.slug,
      archivedAt: row.archived_at
    }
  })

  return parseSyncBundle({
    type: 'steward-sync-bundle',
    formatVersion: 1,
    bundleId: options.bundleId || randomUUID(),
    createdAt,
    sourceDeviceId,
    stewardVersion,
    repos: syncRepos,
    states,
    archives
  })
}

export function serializeSyncBundle(bundle: SyncBundle): string {
  return JSON.stringify(bundle, null, 2)
}
