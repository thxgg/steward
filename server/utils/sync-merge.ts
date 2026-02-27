import { resolve } from 'node:path'
import type { ProgressFile, TasksFile } from '../../app/types/task.js'
import { dbAll } from './db.js'
import { getRepos } from './repos.js'
import { parseStoredProgressFile, parseTasksFile } from './state-schema.js'
import {
  createSyncFieldHashes,
  parseSyncBundle,
  type SyncArchiveRecord,
  type SyncBundle,
  type SyncStateRecord
} from './sync-schema.js'
import { ensureRepoSyncMetaForRepos, type RepoSyncMeta } from './sync-identity.js'

type LocalStateRow = {
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

type LocalArchiveRow = {
  repo_id: string
  slug: string
  archived_at: string
}

type LocalRepoIdentity = {
  repoId: string
  repoPath: string
  syncKey: string
  fingerprint: string
  fingerprintKind: string
}

export type SyncMergePlanOptions = {
  repoMap?: Record<string, string>
}

export type SyncRepoMappingResult = {
  incomingRepoSyncKey: string
  incomingRepoName?: string
  localRepoId?: string
  localRepoPath?: string
  localRepoSyncKey?: string
  source: 'map' | 'sync_key' | 'fingerprint' | 'unresolved'
  reason?: 'map_target_not_found' | 'fingerprint_ambiguous' | 'unknown_repo_metadata' | 'no_match'
}

export type SyncFieldDecision = {
  winner: 'local' | 'incoming'
  reason:
  | 'incoming_newer_clock'
  | 'local_newer_clock'
  | 'incoming_has_clock'
  | 'local_has_clock'
  | 'incoming_hash_tiebreak'
  | 'local_hash_tiebreak'
  | 'equal_value'
  localClock: string | null
  incomingClock: string | null
  localHash: string | null
  incomingHash: string | null
  changed: boolean
  valueChanged: boolean
  clockChanged: boolean
  conflict: boolean
}

export type SyncStateMergePlanRow = {
  repoSyncKey: string
  slug: string
  action: 'insert' | 'update' | 'skip' | 'unresolved'
  localRepoId?: string
  localRepoPath?: string
  mappingSource: SyncRepoMappingResult['source']
  reason?: SyncRepoMappingResult['reason']
  updateFields: Array<'tasks' | 'progress' | 'notes'>
  conflictFields: Array<'tasks' | 'progress' | 'notes'>
  fieldDecisions?: {
    tasks: SyncFieldDecision
    progress: SyncFieldDecision
    notes: SyncFieldDecision
  }
}

export type SyncArchiveMergePlanRow = {
  repoSyncKey: string
  slug: string
  action: 'insert' | 'update' | 'skip' | 'unresolved'
  localRepoId?: string
  localRepoPath?: string
  mappingSource: SyncRepoMappingResult['source']
  reason?: SyncRepoMappingResult['reason']
}

export type SyncMergePlan = {
  bundle: {
    bundleId: string
    formatVersion: number
    sourceDeviceId: string
    createdAt: string
  }
  mappings: SyncRepoMappingResult[]
  states: SyncStateMergePlanRow[]
  archives: SyncArchiveMergePlanRow[]
  summary: {
    repos: {
      mapped: number
      unresolved: number
    }
    states: {
      insert: number
      update: number
      skip: number
      unresolved: number
      conflicts: number
    }
    archives: {
      insert: number
      update: number
      skip: number
      unresolved: number
    }
  }
}

function normalizePath(path: string): string {
  return resolve(path)
}

function createRepoIndex(localRepos: LocalRepoIdentity[]) {
  const byRepoId = new Map<string, LocalRepoIdentity>()
  const byPath = new Map<string, LocalRepoIdentity>()
  const bySyncKey = new Map<string, LocalRepoIdentity>()
  const byFingerprint = new Map<string, LocalRepoIdentity[]>()

  for (const repo of localRepos) {
    byRepoId.set(repo.repoId, repo)
    byPath.set(normalizePath(repo.repoPath), repo)
    bySyncKey.set(repo.syncKey, repo)

    const fingerprintKey = `${repo.fingerprintKind}:${repo.fingerprint}`
    const current = byFingerprint.get(fingerprintKey)
    if (current) {
      current.push(repo)
    } else {
      byFingerprint.set(fingerprintKey, [repo])
    }
  }

  return { byRepoId, byPath, bySyncKey, byFingerprint }
}

function parseLocalJson<T>(
  rawValue: string | null,
  parseValue: (value: unknown) => T,
  fallback: (value: unknown) => T | unknown
): T | unknown | null {
  if (rawValue === null) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    try {
      return parseValue(parsed)
    } catch {
      return fallback(parsed)
    }
  } catch {
    return rawValue
  }
}

function toClock(primary: string | null, fallback: string | null, hasValue: boolean): string | null {
  if (primary) {
    return primary
  }

  if (hasValue) {
    return fallback
  }

  return null
}

function compareIsoTimestamps(a: string | null, b: string | null): number {
  if (a === b) {
    return 0
  }

  if (!a && !b) {
    return 0
  }

  if (!a) {
    return -1
  }

  if (!b) {
    return 1
  }

  const aEpoch = Date.parse(a)
  const bEpoch = Date.parse(b)

  if (Number.isFinite(aEpoch) && Number.isFinite(bEpoch) && aEpoch !== bEpoch) {
    return aEpoch > bEpoch ? 1 : -1
  }

  return a.localeCompare(b)
}

function compareHashes(a: string | null, b: string | null): number {
  const left = a || ''
  const right = b || ''
  return left.localeCompare(right)
}

function decideFieldMerge(params: {
  localClock: string | null
  incomingClock: string | null
  localHash: string | null
  incomingHash: string | null
}): SyncFieldDecision {
  const { localClock, incomingClock, localHash, incomingHash } = params

  const valueChanged = (localHash || '') !== (incomingHash || '')
  const clockChanged = localClock !== incomingClock
  const conflict = valueChanged && localHash !== null && incomingHash !== null

  if (!valueChanged && !clockChanged) {
    return {
      winner: 'local',
      reason: 'equal_value',
      localClock,
      incomingClock,
      localHash,
      incomingHash,
      changed: false,
      valueChanged,
      clockChanged,
      conflict
    }
  }

  if (incomingClock && localClock) {
    const timestampComparison = compareIsoTimestamps(incomingClock, localClock)
    if (timestampComparison > 0) {
      return {
        winner: 'incoming',
        reason: 'incoming_newer_clock',
        localClock,
        incomingClock,
        localHash,
        incomingHash,
        changed: valueChanged || clockChanged,
        valueChanged,
        clockChanged,
        conflict
      }
    }

    if (timestampComparison < 0) {
      return {
        winner: 'local',
        reason: 'local_newer_clock',
        localClock,
        incomingClock,
        localHash,
        incomingHash,
        changed: false,
        valueChanged,
        clockChanged,
        conflict
      }
    }
  } else if (incomingClock && !localClock) {
    return {
      winner: 'incoming',
      reason: 'incoming_has_clock',
      localClock,
      incomingClock,
      localHash,
      incomingHash,
      changed: valueChanged || clockChanged,
      valueChanged,
      clockChanged,
      conflict
    }
  } else if (!incomingClock && localClock) {
    return {
      winner: 'local',
      reason: 'local_has_clock',
      localClock,
      incomingClock,
      localHash,
      incomingHash,
      changed: false,
      valueChanged,
      clockChanged,
      conflict
    }
  }

  const hashComparison = compareHashes(incomingHash, localHash)
  if (hashComparison > 0) {
    return {
      winner: 'incoming',
      reason: 'incoming_hash_tiebreak',
      localClock,
      incomingClock,
      localHash,
      incomingHash,
      changed: valueChanged || clockChanged,
      valueChanged,
      clockChanged,
      conflict
    }
  }

  if (hashComparison < 0) {
    return {
      winner: 'local',
      reason: 'local_hash_tiebreak',
      localClock,
      incomingClock,
      localHash,
      incomingHash,
      changed: false,
      valueChanged,
      clockChanged,
      conflict
    }
  }

  return {
    winner: 'local',
    reason: 'equal_value',
    localClock,
    incomingClock,
    localHash,
    incomingHash,
    changed: false,
    valueChanged,
    clockChanged,
    conflict
  }
}

function buildStateKey(repoId: string, slug: string): string {
  return `${repoId}:${slug}`
}

function resolveMappedRepo(
  incomingRepoSyncKey: string,
  incomingRepoMeta: { name?: string; fingerprint?: string; fingerprintKind?: string } | null,
  repoIndex: ReturnType<typeof createRepoIndex>,
  repoMap: Record<string, string>
): SyncRepoMappingResult {
  const mappedValue = repoMap[incomingRepoSyncKey]
  if (typeof mappedValue === 'string' && mappedValue.trim().length > 0) {
    const target = mappedValue.trim()
    const byId = repoIndex.byRepoId.get(target)
      || repoIndex.byPath.get(normalizePath(target))
      || repoIndex.bySyncKey.get(target)

    if (!byId) {
      return {
        incomingRepoSyncKey,
        ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
        source: 'unresolved',
        reason: 'map_target_not_found'
      }
    }

    return {
      incomingRepoSyncKey,
      ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
      localRepoId: byId.repoId,
      localRepoPath: byId.repoPath,
      localRepoSyncKey: byId.syncKey,
      source: 'map'
    }
  }

  const bySyncKey = repoIndex.bySyncKey.get(incomingRepoSyncKey)
  if (bySyncKey) {
    return {
      incomingRepoSyncKey,
      ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
      localRepoId: bySyncKey.repoId,
      localRepoPath: bySyncKey.repoPath,
      localRepoSyncKey: bySyncKey.syncKey,
      source: 'sync_key'
    }
  }

  if (!incomingRepoMeta?.fingerprint || !incomingRepoMeta.fingerprintKind) {
    return {
      incomingRepoSyncKey,
      ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
      source: 'unresolved',
      reason: incomingRepoMeta ? 'no_match' : 'unknown_repo_metadata'
    }
  }

  const fingerprintKey = `${incomingRepoMeta.fingerprintKind}:${incomingRepoMeta.fingerprint}`
  const matches = repoIndex.byFingerprint.get(fingerprintKey) || []

  if (matches.length === 1) {
    const matchedRepo = matches[0]!
    return {
      incomingRepoSyncKey,
      ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
      localRepoId: matchedRepo.repoId,
      localRepoPath: matchedRepo.repoPath,
      localRepoSyncKey: matchedRepo.syncKey,
      source: 'fingerprint'
    }
  }

  if (matches.length > 1) {
    return {
      incomingRepoSyncKey,
      ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
      source: 'unresolved',
      reason: 'fingerprint_ambiguous'
    }
  }

  return {
    incomingRepoSyncKey,
    ...(incomingRepoMeta?.name ? { incomingRepoName: incomingRepoMeta.name } : {}),
    source: 'unresolved',
    reason: 'no_match'
  }
}

async function loadLocalStateRows(repoIds: string[]): Promise<Map<string, LocalStateRow>> {
  if (repoIds.length === 0) {
    return new Map()
  }

  const placeholders = repoIds.map(() => '?').join(', ')
  const rows = await dbAll<LocalStateRow>(
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
    `,
    repoIds
  )

  const byKey = new Map<string, LocalStateRow>()
  for (const row of rows) {
    byKey.set(buildStateKey(row.repo_id, row.slug), row)
  }

  return byKey
}

async function loadLocalArchiveRows(repoIds: string[]): Promise<Map<string, LocalArchiveRow>> {
  if (repoIds.length === 0) {
    return new Map()
  }

  const placeholders = repoIds.map(() => '?').join(', ')
  const rows = await dbAll<LocalArchiveRow>(
    `
      SELECT repo_id, slug, archived_at
      FROM prd_archives
      WHERE repo_id IN (${placeholders})
    `,
    repoIds
  )

  const byKey = new Map<string, LocalArchiveRow>()
  for (const row of rows) {
    byKey.set(buildStateKey(row.repo_id, row.slug), row)
  }

  return byKey
}

function getIncomingRepoMeta(bundle: SyncBundle, repoSyncKey: string): { name?: string; fingerprint?: string; fingerprintKind?: string } | null {
  const repo = bundle.repos.find((entry) => entry.repoSyncKey === repoSyncKey)
  if (!repo) {
    return null
  }

  return {
    name: repo.name,
    fingerprint: repo.fingerprint,
    fingerprintKind: repo.fingerprintKind
  }
}

function parseLocalTasks(row: LocalStateRow): TasksFile | unknown | null {
  return parseLocalJson(row.tasks_json, parseTasksFile, (value) => value)
}

function parseLocalProgress(row: LocalStateRow, tasks: TasksFile | unknown | null): ProgressFile | unknown | null {
  return parseLocalJson(
    row.progress_json,
    (value) => parseStoredProgressFile(value, {
      totalTasksHint: tasks && typeof tasks === 'object' && !Array.isArray(tasks)
        ? Array.isArray((tasks as { tasks?: unknown }).tasks)
          ? ((tasks as { tasks: unknown[] }).tasks.length)
          : undefined
        : undefined,
      prdNameFallback: row.slug
    }),
    (value) => value
  )
}

function buildStateRowPlan(params: {
  row: SyncStateRecord
  mapping: SyncRepoMappingResult
  localStateRows: Map<string, LocalStateRow>
}): SyncStateMergePlanRow {
  const { row, mapping, localStateRows } = params

  if (!mapping.localRepoId || mapping.source === 'unresolved') {
    return {
      repoSyncKey: row.repoSyncKey,
      slug: row.slug,
      action: 'unresolved',
      mappingSource: mapping.source,
      ...(mapping.reason ? { reason: mapping.reason } : {}),
      updateFields: [],
      conflictFields: []
    }
  }

  const stateKey = buildStateKey(mapping.localRepoId, row.slug)
  const localRow = localStateRows.get(stateKey)

  if (!localRow) {
    return {
      repoSyncKey: row.repoSyncKey,
      slug: row.slug,
      action: 'insert',
      localRepoId: mapping.localRepoId,
      ...(mapping.localRepoPath ? { localRepoPath: mapping.localRepoPath } : {}),
      mappingSource: mapping.source,
      updateFields: ['tasks', 'progress', 'notes'],
      conflictFields: []
    }
  }

  const localTasks = parseLocalTasks(localRow)
  const localProgress = parseLocalProgress(localRow, localTasks)
  const localNotes = localRow.notes_md

  const localClocks = {
    tasksUpdatedAt: toClock(localRow.tasks_updated_at, localRow.updated_at, localTasks !== null),
    progressUpdatedAt: toClock(localRow.progress_updated_at, localRow.updated_at, localProgress !== null),
    notesUpdatedAt: toClock(localRow.notes_updated_at, localRow.updated_at, localNotes !== null)
  }

  const localHashes = createSyncFieldHashes({
    tasks: localTasks,
    progress: localProgress,
    notes: localNotes
  })

  const incomingHashes = createSyncFieldHashes({
    tasks: row.tasks,
    progress: row.progress,
    notes: row.notes
  })

  const tasksDecision = decideFieldMerge({
    localClock: localClocks.tasksUpdatedAt,
    incomingClock: row.clocks.tasksUpdatedAt,
    localHash: localHashes.tasksHash,
    incomingHash: incomingHashes.tasksHash
  })

  const progressDecision = decideFieldMerge({
    localClock: localClocks.progressUpdatedAt,
    incomingClock: row.clocks.progressUpdatedAt,
    localHash: localHashes.progressHash,
    incomingHash: incomingHashes.progressHash
  })

  const notesDecision = decideFieldMerge({
    localClock: localClocks.notesUpdatedAt,
    incomingClock: row.clocks.notesUpdatedAt,
    localHash: localHashes.notesHash,
    incomingHash: incomingHashes.notesHash
  })

  const updateFields: Array<'tasks' | 'progress' | 'notes'> = []
  const conflictFields: Array<'tasks' | 'progress' | 'notes'> = []

  if (tasksDecision.changed) {
    updateFields.push('tasks')
  }
  if (progressDecision.changed) {
    updateFields.push('progress')
  }
  if (notesDecision.changed) {
    updateFields.push('notes')
  }

  if (tasksDecision.conflict) {
    conflictFields.push('tasks')
  }
  if (progressDecision.conflict) {
    conflictFields.push('progress')
  }
  if (notesDecision.conflict) {
    conflictFields.push('notes')
  }

  return {
    repoSyncKey: row.repoSyncKey,
    slug: row.slug,
    action: updateFields.length > 0 ? 'update' : 'skip',
    localRepoId: mapping.localRepoId,
    ...(mapping.localRepoPath ? { localRepoPath: mapping.localRepoPath } : {}),
    mappingSource: mapping.source,
    updateFields,
    conflictFields,
    fieldDecisions: {
      tasks: tasksDecision,
      progress: progressDecision,
      notes: notesDecision
    }
  }
}

function buildArchiveRowPlan(params: {
  row: SyncArchiveRecord
  mapping: SyncRepoMappingResult
  localArchiveRows: Map<string, LocalArchiveRow>
}): SyncArchiveMergePlanRow {
  const { row, mapping, localArchiveRows } = params

  if (!mapping.localRepoId || mapping.source === 'unresolved') {
    return {
      repoSyncKey: row.repoSyncKey,
      slug: row.slug,
      action: 'unresolved',
      mappingSource: mapping.source,
      ...(mapping.reason ? { reason: mapping.reason } : {})
    }
  }

  const archiveKey = buildStateKey(mapping.localRepoId, row.slug)
  const localRow = localArchiveRows.get(archiveKey)
  if (!localRow) {
    return {
      repoSyncKey: row.repoSyncKey,
      slug: row.slug,
      action: 'insert',
      localRepoId: mapping.localRepoId,
      ...(mapping.localRepoPath ? { localRepoPath: mapping.localRepoPath } : {}),
      mappingSource: mapping.source
    }
  }

  const incomingIsNewer = compareIsoTimestamps(row.archivedAt, localRow.archived_at) > 0
  return {
    repoSyncKey: row.repoSyncKey,
    slug: row.slug,
    action: incomingIsNewer ? 'update' : 'skip',
    localRepoId: mapping.localRepoId,
    ...(mapping.localRepoPath ? { localRepoPath: mapping.localRepoPath } : {}),
    mappingSource: mapping.source
  }
}

export async function planSyncMerge(bundleInput: unknown, options: SyncMergePlanOptions = {}): Promise<SyncMergePlan> {
  const bundle = parseSyncBundle(bundleInput)
  const localRepos = await getRepos()
  const repoMetaById = await ensureRepoSyncMetaForRepos(localRepos)

  const identities: LocalRepoIdentity[] = localRepos.map((repo) => {
    const meta: RepoSyncMeta | undefined = repoMetaById.get(repo.id)
    if (!meta) {
      throw new Error(`Missing sync metadata for local repository ${repo.id}`)
    }

    return {
      repoId: repo.id,
      repoPath: repo.path,
      syncKey: meta.syncKey,
      fingerprint: meta.fingerprint,
      fingerprintKind: meta.fingerprintKind
    }
  })

  const repoIndex = createRepoIndex(identities)
  const incomingRepoKeys = new Set<string>()

  for (const repo of bundle.repos) {
    incomingRepoKeys.add(repo.repoSyncKey)
  }
  for (const row of bundle.states) {
    incomingRepoKeys.add(row.repoSyncKey)
  }
  for (const row of bundle.archives) {
    incomingRepoKeys.add(row.repoSyncKey)
  }

  const mappingResults: SyncRepoMappingResult[] = Array.from(incomingRepoKeys)
    .sort((a, b) => a.localeCompare(b))
    .map((repoSyncKey) => {
      return resolveMappedRepo(
        repoSyncKey,
        getIncomingRepoMeta(bundle, repoSyncKey),
        repoIndex,
        options.repoMap || {}
      )
    })

  const mappingByIncomingKey = new Map(mappingResults.map((result) => [result.incomingRepoSyncKey, result]))

  const mappedRepoIds = Array.from(new Set(
    mappingResults
      .map((result) => result.localRepoId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  ))

  const [localStateRows, localArchiveRows] = await Promise.all([
    loadLocalStateRows(mappedRepoIds),
    loadLocalArchiveRows(mappedRepoIds)
  ])

  const statePlans = bundle.states.map((row) => {
    const mapping = mappingByIncomingKey.get(row.repoSyncKey) || {
      incomingRepoSyncKey: row.repoSyncKey,
      source: 'unresolved' as const,
      reason: 'unknown_repo_metadata' as const
    }

    return buildStateRowPlan({
      row,
      mapping,
      localStateRows
    })
  })

  const archivePlans = bundle.archives.map((row) => {
    const mapping = mappingByIncomingKey.get(row.repoSyncKey) || {
      incomingRepoSyncKey: row.repoSyncKey,
      source: 'unresolved' as const,
      reason: 'unknown_repo_metadata' as const
    }

    return buildArchiveRowPlan({
      row,
      mapping,
      localArchiveRows
    })
  })

  const summary = {
    repos: {
      mapped: mappingResults.filter((result) => result.source !== 'unresolved').length,
      unresolved: mappingResults.filter((result) => result.source === 'unresolved').length
    },
    states: {
      insert: statePlans.filter((row) => row.action === 'insert').length,
      update: statePlans.filter((row) => row.action === 'update').length,
      skip: statePlans.filter((row) => row.action === 'skip').length,
      unresolved: statePlans.filter((row) => row.action === 'unresolved').length,
      conflicts: statePlans.reduce((sum, row) => sum + row.conflictFields.length, 0)
    },
    archives: {
      insert: archivePlans.filter((row) => row.action === 'insert').length,
      update: archivePlans.filter((row) => row.action === 'update').length,
      skip: archivePlans.filter((row) => row.action === 'skip').length,
      unresolved: archivePlans.filter((row) => row.action === 'unresolved').length
    }
  }

  return {
    bundle: {
      bundleId: bundle.bundleId,
      formatVersion: bundle.formatVersion,
      sourceDeviceId: bundle.sourceDeviceId,
      createdAt: bundle.createdAt
    },
    mappings: mappingResults,
    states: statePlans,
    archives: archivePlans,
    summary
  }
}

export async function planSyncMergeJson(jsonPayload: string, options: SyncMergePlanOptions = {}): Promise<SyncMergePlan> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonPayload) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid bundle JSON: ${message}`)
  }

  return await planSyncMerge(parsed, options)
}
