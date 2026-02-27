import { parseSyncBundle, type SyncBundle, type SyncRepoRecord } from './sync-schema.js'

export type SyncRepoInspection = {
  repoSyncKey: string
  name: string
  pathHint?: string
  fingerprint: string
  fingerprintKind: string
  stateCount: number
  archiveCount: number
  stateSlugs: string[]
  archiveSlugs: string[]
}

export type SyncBundleInspection = {
  type: string
  formatVersion: number
  bundleId: string
  createdAt: string
  sourceDeviceId: string
  stewardVersion: string
  totals: {
    repos: number
    states: number
    archives: number
    unknownRepoStates: number
    unknownRepoArchives: number
  }
  repos: SyncRepoInspection[]
  unknownRepoStates: Array<{ repoSyncKey: string; slugs: string[] }>
  unknownRepoArchives: Array<{ repoSyncKey: string; slugs: string[] }>
}

type RepoInspectionAccumulator = {
  repo: SyncRepoRecord
  stateSlugs: string[]
  archiveSlugs: string[]
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function sortByKey<T extends { repoSyncKey: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => a.repoSyncKey.localeCompare(b.repoSyncKey))
}

function toRepoInspection(accumulator: RepoInspectionAccumulator): SyncRepoInspection {
  const stateSlugs = uniqueSorted(accumulator.stateSlugs)
  const archiveSlugs = uniqueSorted(accumulator.archiveSlugs)

  return {
    repoSyncKey: accumulator.repo.repoSyncKey,
    name: accumulator.repo.name,
    ...(accumulator.repo.pathHint ? { pathHint: accumulator.repo.pathHint } : {}),
    fingerprint: accumulator.repo.fingerprint,
    fingerprintKind: accumulator.repo.fingerprintKind,
    stateCount: stateSlugs.length,
    archiveCount: archiveSlugs.length,
    stateSlugs,
    archiveSlugs
  }
}

function collectUnknownRepoRows(
  rows: Array<{ repoSyncKey: string; slug: string }>,
  knownRepoKeys: Set<string>
): Array<{ repoSyncKey: string; slugs: string[] }> {
  const slugsByRepoKey = new Map<string, string[]>()

  for (const row of rows) {
    if (knownRepoKeys.has(row.repoSyncKey)) {
      continue
    }

    const current = slugsByRepoKey.get(row.repoSyncKey)
    if (current) {
      current.push(row.slug)
    } else {
      slugsByRepoKey.set(row.repoSyncKey, [row.slug])
    }
  }

  return Array.from(slugsByRepoKey.entries())
    .map(([repoSyncKey, slugs]) => ({
      repoSyncKey,
      slugs: uniqueSorted(slugs)
    }))
    .sort((a, b) => a.repoSyncKey.localeCompare(b.repoSyncKey))
}

export function inspectSyncBundle(bundleInput: unknown): SyncBundleInspection {
  const bundle: SyncBundle = parseSyncBundle(bundleInput)
  const repoAccumulators = new Map<string, RepoInspectionAccumulator>()

  for (const repo of sortByKey(bundle.repos)) {
    repoAccumulators.set(repo.repoSyncKey, {
      repo,
      stateSlugs: [],
      archiveSlugs: []
    })
  }

  for (const state of bundle.states) {
    const accumulator = repoAccumulators.get(state.repoSyncKey)
    if (!accumulator) {
      continue
    }

    accumulator.stateSlugs.push(state.slug)
  }

  for (const archive of bundle.archives) {
    const accumulator = repoAccumulators.get(archive.repoSyncKey)
    if (!accumulator) {
      continue
    }

    accumulator.archiveSlugs.push(archive.slug)
  }

  const repos = Array.from(repoAccumulators.values())
    .map((entry) => toRepoInspection(entry))
    .sort((a, b) => a.repoSyncKey.localeCompare(b.repoSyncKey))

  const knownRepoKeys = new Set(bundle.repos.map((repo) => repo.repoSyncKey))
  const unknownRepoStates = collectUnknownRepoRows(bundle.states, knownRepoKeys)
  const unknownRepoArchives = collectUnknownRepoRows(bundle.archives, knownRepoKeys)

  return {
    type: bundle.type,
    formatVersion: bundle.formatVersion,
    bundleId: bundle.bundleId,
    createdAt: bundle.createdAt,
    sourceDeviceId: bundle.sourceDeviceId,
    stewardVersion: bundle.stewardVersion,
    totals: {
      repos: bundle.repos.length,
      states: bundle.states.length,
      archives: bundle.archives.length,
      unknownRepoStates: unknownRepoStates.reduce((sum, item) => sum + item.slugs.length, 0),
      unknownRepoArchives: unknownRepoArchives.reduce((sum, item) => sum + item.slugs.length, 0)
    },
    repos,
    unknownRepoStates,
    unknownRepoArchives
  }
}

export function inspectSyncBundleJson(jsonPayload: string): SyncBundleInspection {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonPayload) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid bundle JSON: ${message}`)
  }

  return inspectSyncBundle(parsed)
}
