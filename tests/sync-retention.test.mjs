import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { addRepo } from '../dist/server/utils/repos.js'
import { upsertPrdState } from '../dist/server/utils/prd-state.js'
import { dbAll, dbGet, dbRun, getDbPath } from '../dist/server/utils/db.js'
import { executeSyncMerge } from '../dist/server/utils/sync-apply.js'

async function createRepoFixture(rootDir, repoName, slug) {
  const repoPath = join(rootDir, repoName)
  const prdDir = join(repoPath, 'docs', 'prd')
  await mkdir(prdDir, { recursive: true })
  await writeFile(join(prdDir, `${slug}.md`), `# ${slug}\n`)
  return repoPath
}

async function setRepoSyncKey(repoId, syncKey, updatedAt) {
  await dbRun(
    `
      UPDATE repo_sync_meta
      SET sync_key = ?, updated_at = ?
      WHERE repo_id = ?
    `,
    [syncKey, updatedAt, repoId]
  )
}

async function listBackupFiles(dbPath) {
  const backupDir = dirname(dbPath)
  const filePrefix = `${basename(dbPath)}.sync-backup.`
  const entries = await readdir(backupDir)
  return entries
    .filter((name) => name.startsWith(filePrefix) && name.endsWith('.db'))
    .sort((a, b) => a.localeCompare(b))
}

async function setupRetentionScenario(tempRoot, slug, syncKey, localNote, localNoteClock) {
  const repoPath = await createRepoFixture(tempRoot, 'repo-retention', slug)
  const repo = await addRepo(repoPath, 'Retention Repo')

  await setRepoSyncKey(repo.id, syncKey, '2026-03-10T00:00:00.000Z')

  await upsertPrdState(repo.id, slug, {
    tasks: {
      prd: {
        name: 'Retention PRD',
        source: `docs/prd/${slug}.md`,
        createdAt: '2026-03-01T00:00:00.000Z'
      },
      tasks: []
    },
    progress: {
      prdName: 'Retention PRD',
      totalTasks: 0,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-03-01T00:00:00.000Z',
      patterns: [],
      taskLogs: []
    },
    notes: localNote
  })

  await dbRun(
    `
      UPDATE prd_states
      SET notes_updated_at = ?, updated_at = ?
      WHERE repo_id = ? AND slug = ?
    `,
    [localNoteClock, localNoteClock, repo.id, slug]
  )

  return repo
}

function createIncomingBundle(slug, syncKey, bundleId, notes, notesUpdatedAt) {
  return {
    type: 'steward-sync-bundle',
    formatVersion: 1,
    bundleId,
    createdAt: '2026-03-20T00:00:00.000Z',
    sourceDeviceId: 'device-retention',
    stewardVersion: '0.1.24',
    repos: [
      {
        repoSyncKey: syncKey,
        name: 'Retention Repo',
        pathHint: 'repo-retention',
        fingerprint: 'unused-fingerprint',
        fingerprintKind: 'repo-shape-v1'
      }
    ],
    states: [
      {
        repoSyncKey: syncKey,
        slug,
        tasks: null,
        progress: null,
        notes,
        clocks: {
          tasksUpdatedAt: null,
          progressUpdatedAt: null,
          notesUpdatedAt
        },
        hashes: {
          tasksHash: null,
          progressHash: null,
          notesHash: null
        }
      }
    ],
    archives: []
  }
}

test('retention pruning removes old backups/logs and enforces max counts', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-retention-prune-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'retention-prune-prd'
    const syncKey = 'rsk-retention-prune'
    const repo = await setupRetentionScenario(tempRoot, slug, syncKey, 'local note', '2026-03-01T00:00:00.000Z')

    const bundle = createIncomingBundle(
      slug,
      syncKey,
      'bundle-retention-prune-001',
      'incoming note',
      '2026-03-20T00:00:00.000Z'
    )

    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['log-old-1', 'device-old', '2000-01-01T00:00:00.000Z', '{}']
    )
    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['log-old-2', 'device-old', '2000-01-02T00:00:00.000Z', '{}']
    )
    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['log-keep-1', 'device-keep', '2026-03-10T00:00:00.000Z', '{}']
    )
    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['log-keep-2', 'device-keep', '2026-03-11T00:00:00.000Z', '{}']
    )

    const dbPath = getDbPath()
    const backupDir = dirname(dbPath)
    const backupPrefix = `${basename(dbPath)}.sync-backup.`

    const oldBackupA = join(backupDir, `${backupPrefix}old-a.db`)
    const oldBackupB = join(backupDir, `${backupPrefix}old-b.db`)
    const keepBackupA = join(backupDir, `${backupPrefix}keep-a.db`)
    const keepBackupB = join(backupDir, `${backupPrefix}keep-b.db`)

    await writeFile(oldBackupA, 'old-a')
    await writeFile(oldBackupB, 'old-b')
    await writeFile(keepBackupA, 'keep-a')
    await writeFile(keepBackupB, 'keep-b')

    await utimes(oldBackupA, new Date('2000-01-01T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'))
    await utimes(oldBackupB, new Date('2000-01-02T00:00:00.000Z'), new Date('2000-01-02T00:00:00.000Z'))
    await utimes(keepBackupA, new Date('2026-03-10T00:00:00.000Z'), new Date('2026-03-10T00:00:00.000Z'))
    await utimes(keepBackupB, new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-11T00:00:00.000Z'))

    const result = await executeSyncMerge(bundle, {
      apply: true,
      now: '2026-03-15T00:00:00.000Z',
      backupRetentionDays: 7,
      maxBackups: 2,
      logRetentionDays: 7,
      maxLogEntries: 2
    })

    assert.equal(result.applied, true)
    assert.equal(result.alreadyApplied, false)
    assert.equal(result.retention.backupsDeleted, 3)
    assert.equal(result.retention.logsDeleted, 3)

    const remainingBackups = await listBackupFiles(dbPath)
    assert.equal(remainingBackups.length, 2)
    assert.equal(remainingBackups.some((name) => name.includes('old-a')), false)
    assert.equal(remainingBackups.some((name) => name.includes('old-b')), false)

    const remainingLogs = await dbAll(
      'SELECT bundle_id FROM sync_bundle_log ORDER BY applied_at ASC, bundle_id ASC'
    )
    assert.deepEqual(
      remainingLogs.map((row) => row.bundle_id),
      ['log-keep-2', 'bundle-retention-prune-001']
    )

    const updatedNotes = await dbGet(
      'SELECT notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.equal(updatedNotes.notes_md, 'incoming note')
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('retention pruning is idempotent and safe when nothing exceeds limits', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-retention-noop-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'retention-noop-prd'
    const syncKey = 'rsk-retention-noop'
    await setupRetentionScenario(tempRoot, slug, syncKey, 'local noop note', '2026-03-01T00:00:00.000Z')

    const bundle = createIncomingBundle(
      slug,
      syncKey,
      'bundle-retention-noop-001',
      'incoming noop note',
      '2026-03-20T00:00:00.000Z'
    )

    const firstApply = await executeSyncMerge(bundle, {
      apply: true,
      now: '2026-03-20T00:00:00.000Z',
      backupRetentionDays: 365,
      maxBackups: 20,
      logRetentionDays: 365,
      maxLogEntries: 1000
    })

    assert.equal(firstApply.applied, true)
    assert.equal(firstApply.retention.backupsDeleted, 0)
    assert.equal(firstApply.retention.logsDeleted, 0)

    const secondApply = await executeSyncMerge(bundle, {
      apply: true,
      now: '2026-03-21T00:00:00.000Z',
      backupRetentionDays: 365,
      maxBackups: 20,
      logRetentionDays: 365,
      maxLogEntries: 1000
    })

    assert.equal(secondApply.applied, false)
    assert.equal(secondApply.alreadyApplied, true)
    assert.equal(secondApply.retention.backupsDeleted, 0)
    assert.equal(secondApply.retention.logsDeleted, 0)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
