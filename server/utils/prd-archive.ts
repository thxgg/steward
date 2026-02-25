import { emitChange } from './change-events.js'
import { dbAll, dbGet, dbRun } from './db.js'

type PrdArchiveRow = {
  slug: string
  archived_at: string
}

type PrdArchiveTimestampRow = {
  archived_at: string
}

export type PrdArchiveState = {
  archived: boolean
  archivedAt?: string
}

function toArchiveState(archivedAt: string | null | undefined): PrdArchiveState {
  if (!archivedAt) {
    return { archived: false }
  }

  return {
    archived: true,
    archivedAt
  }
}

export async function getPrdArchiveMap(repoId: string): Promise<Map<string, string>> {
  const rows = await dbAll<PrdArchiveRow>(
    'SELECT slug, archived_at FROM prd_archives WHERE repo_id = ?',
    [repoId]
  )

  const archiveMap = new Map<string, string>()
  for (const row of rows) {
    archiveMap.set(row.slug, row.archived_at)
  }

  return archiveMap
}

export async function getPrdArchiveState(repoId: string, slug: string): Promise<PrdArchiveState> {
  const row = await dbGet<PrdArchiveTimestampRow>(
    'SELECT archived_at FROM prd_archives WHERE repo_id = ? AND slug = ?',
    [repoId, slug]
  )

  return toArchiveState(row?.archived_at)
}

export async function setPrdArchived(repoId: string, slug: string, archived: boolean): Promise<PrdArchiveState> {
  if (archived) {
    const archivedAt = new Date().toISOString()
    const result = await dbRun(
      `
        INSERT INTO prd_archives (repo_id, slug, archived_at)
        VALUES (?, ?, ?)
        ON CONFLICT(repo_id, slug) DO NOTHING
      `,
      [repoId, slug, archivedAt]
    )

    const row = await dbGet<PrdArchiveTimestampRow>(
      'SELECT archived_at FROM prd_archives WHERE repo_id = ? AND slug = ?',
      [repoId, slug]
    )

    if (result.changes > 0) {
      emitChange({
        type: 'change',
        path: `state://${repoId}/${slug}.archive`,
        repoId,
        category: 'prd'
      })
    }

    return toArchiveState(row?.archived_at || archivedAt)
  }

  const result = await dbRun(
    'DELETE FROM prd_archives WHERE repo_id = ? AND slug = ?',
    [repoId, slug]
  )

  if (result.changes > 0) {
    emitChange({
      type: 'change',
      path: `state://${repoId}/${slug}.archive`,
      repoId,
      category: 'prd'
    })
  }

  return { archived: false }
}
