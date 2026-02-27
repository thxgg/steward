import { createHash } from 'node:crypto'
import { z } from 'zod'

export const SYNC_BUNDLE_TYPE = 'steward-sync-bundle'
export const SYNC_BUNDLE_FORMAT_VERSION = 1

const prdSlugSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/)

const syncRepoSchema = z.object({
  repoSyncKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  pathHint: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
  fingerprintKind: z.string().trim().min(1)
})

const syncFieldClocksSchema = z.object({
  tasksUpdatedAt: z.string().nullable(),
  progressUpdatedAt: z.string().nullable(),
  notesUpdatedAt: z.string().nullable()
})

const syncFieldHashesSchema = z.object({
  tasksHash: z.string().nullable(),
  progressHash: z.string().nullable(),
  notesHash: z.string().nullable()
})

const syncStateRowSchema = z.object({
  repoSyncKey: z.string().trim().min(1),
  slug: prdSlugSchema,
  tasks: z.unknown().nullable(),
  progress: z.unknown().nullable(),
  notes: z.string().nullable(),
  clocks: syncFieldClocksSchema,
  hashes: syncFieldHashesSchema
})

const syncArchiveRowSchema = z.object({
  repoSyncKey: z.string().trim().min(1),
  slug: prdSlugSchema,
  archivedAt: z.string().trim().min(1)
})

const syncBundleSchema = z.object({
  type: z.literal(SYNC_BUNDLE_TYPE),
  formatVersion: z.literal(SYNC_BUNDLE_FORMAT_VERSION),
  bundleId: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  sourceDeviceId: z.string().trim().min(1),
  stewardVersion: z.string().trim().min(1),
  repos: z.array(syncRepoSchema),
  states: z.array(syncStateRowSchema),
  archives: z.array(syncArchiveRowSchema)
})

export type SyncRepoRecord = z.infer<typeof syncRepoSchema>
export type SyncFieldClocks = z.infer<typeof syncFieldClocksSchema>
export type SyncFieldHashes = z.infer<typeof syncFieldHashesSchema>
export type SyncStateRecord = z.infer<typeof syncStateRowSchema>
export type SyncArchiveRecord = z.infer<typeof syncArchiveRowSchema>
export type SyncBundle = z.infer<typeof syncBundleSchema>

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const objectValue = value as Record<string, unknown>
  const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b))
  const result: Record<string, unknown> = {}

  for (const key of keys) {
    result[key] = canonicalize(objectValue[key])
  }

  return result
}

export function toCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashCanonicalValue(value: unknown): string {
  return createHash('sha256').update(toCanonicalJson(value)).digest('hex')
}

export function hashNullableCanonicalValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return hashCanonicalValue(value)
}

export function createSyncFieldHashes(fields: {
  tasks: unknown | null
  progress: unknown | null
  notes: string | null
}): SyncFieldHashes {
  return {
    tasksHash: hashNullableCanonicalValue(fields.tasks),
    progressHash: hashNullableCanonicalValue(fields.progress),
    notesHash: hashNullableCanonicalValue(fields.notes)
  }
}

export function parseSyncBundle(value: unknown): SyncBundle {
  return syncBundleSchema.parse(value)
}

export function validateSyncBundle(value: unknown): { success: boolean; error?: string } {
  const parsed = syncBundleSchema.safeParse(value)
  if (parsed.success) {
    return { success: true }
  }

  const issue = parsed.error.issues[0]
  if (!issue) {
    return { success: false, error: 'Invalid sync bundle payload' }
  }

  return {
    success: false,
    error: issue.path.length > 0
      ? `${issue.path.join('.')}: ${issue.message}`
      : issue.message
  }
}
