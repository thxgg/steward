import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { dbGet, dbRun, getDbPath } from '../dist/server/utils/db.js'
import { upsertPrdState } from '../dist/server/utils/prd-state.js'
import { addRepo } from '../dist/server/utils/repos.js'
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
  return entries.filter((name) => name.startsWith(filePrefix) && name.endsWith('.db'))
}

test('executeSyncMerge applies planned changes, enforces retention, and is idempotent', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-apply-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'apply-prd'
    const repoPath = await createRepoFixture(tempRoot, 'repo-apply', slug)
    const repo = await addRepo(repoPath, 'Repo Apply')
    await setRepoSyncKey(repo.id, 'rsk-local-apply', '2026-02-27T00:00:00.000Z')

    await upsertPrdState(repo.id, slug, {
      tasks: {
        prd: {
          name: 'Apply PRD',
          source: `docs/prd/${slug}.md`,
          createdAt: '2026-02-27T00:00:00.000Z'
        },
        tasks: [
          {
            id: 'task-001',
            category: 'feature',
            title: 'Local title',
            description: 'Local task description',
            steps: ['Local step'],
            passes: ['Local pass'],
            dependencies: [],
            priority: 'high',
            status: 'pending'
          }
        ]
      },
      progress: {
        prdName: 'Apply PRD',
        totalTasks: 1,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        startedAt: null,
        lastUpdated: '2026-02-27T00:00:00.000Z',
        patterns: [],
        taskLogs: []
      },
      notes: 'local note'
    })

    await dbRun(
      `
        UPDATE prd_states
        SET
          tasks_updated_at = ?,
          progress_updated_at = ?,
          notes_updated_at = ?,
          updated_at = ?
        WHERE repo_id = ? AND slug = ?
      `,
      [
        '2026-02-27T00:00:00.000Z',
        '2026-02-27T00:00:00.000Z',
        '2026-02-27T00:00:00.000Z',
        '2026-02-27T00:00:00.000Z',
        repo.id,
        slug
      ]
    )

    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['old-log-1', 'device-old', '2000-01-01T00:00:00.000Z', '{"states":0}']
    )
    await dbRun(
      'INSERT INTO sync_bundle_log (bundle_id, source_device_id, applied_at, summary_json) VALUES (?, ?, ?, ?)',
      ['old-log-2', 'device-old', '2000-01-02T00:00:00.000Z', '{"states":0}']
    )

    const dbPath = getDbPath()
    const backupDir = dirname(dbPath)
    const oldBackupOne = join(backupDir, `${basename(dbPath)}.sync-backup.19990101T000000000Z-old-1.db`)
    const oldBackupTwo = join(backupDir, `${basename(dbPath)}.sync-backup.19990102T000000000Z-old-2.db`)
    await writeFile(oldBackupOne, 'old-backup-1')
    await writeFile(oldBackupTwo, 'old-backup-2')
    await utimes(oldBackupOne, new Date('1999-01-01T00:00:00.000Z'), new Date('1999-01-01T00:00:00.000Z'))
    await utimes(oldBackupTwo, new Date('1999-01-02T00:00:00.000Z'), new Date('1999-01-02T00:00:00.000Z'))

    const bundle = {
      type: 'steward-sync-bundle',
      formatVersion: 1,
      bundleId: 'bundle-apply-001',
      createdAt: '2026-03-01T00:00:00.000Z',
      sourceDeviceId: 'device-001',
      stewardVersion: '0.1.24',
      repos: [
        {
          repoSyncKey: 'rsk-local-apply',
          name: 'Repo Apply',
          pathHint: 'repo-apply',
          fingerprint: 'unused-fingerprint',
          fingerprintKind: 'repo-shape-v1'
        }
      ],
      states: [
        {
          repoSyncKey: 'rsk-local-apply',
          slug,
          tasks: {
            prd: {
              name: 'Apply PRD',
              source: `docs/prd/${slug}.md`,
              createdAt: '2026-02-27T00:00:00.000Z'
            },
            tasks: [
              {
                id: 'task-001',
                category: 'feature',
                title: 'Incoming title',
                description: 'Incoming task description',
                steps: ['Incoming step'],
                passes: ['Incoming pass'],
                dependencies: [],
                priority: 'high',
                status: 'pending'
              }
            ]
          },
          progress: {
            prdName: 'Apply PRD',
            totalTasks: 1,
            completed: 1,
            inProgress: 0,
            blocked: 0,
            startedAt: null,
            lastUpdated: '2026-03-01T00:00:00.000Z',
            patterns: [{ name: 'sync', description: 'sync' }],
            taskLogs: []
          },
          notes: 'incoming note',
          clocks: {
            tasksUpdatedAt: '2026-03-01T00:00:00.000Z',
            progressUpdatedAt: '2026-03-01T00:00:00.000Z',
            notesUpdatedAt: '2026-03-01T00:00:00.000Z'
          },
          hashes: {
            tasksHash: null,
            progressHash: null,
            notesHash: null
          }
        }
      ],
      archives: [
        {
          repoSyncKey: 'rsk-local-apply',
          slug,
          archivedAt: '2026-03-01T00:00:00.000Z'
        }
      ]
    }

    const dryRun = await executeSyncMerge(bundle, { apply: false })
    assert.equal(dryRun.mode, 'dry_run')
    assert.equal(dryRun.applied, false)
    assert.equal(dryRun.plan.summary.states.update, 1)

    const beforeApply = await dbGet(
      'SELECT tasks_json, progress_json, notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.ok(beforeApply)
    assert.equal(beforeApply.notes_md, 'local note')

    const applyResult = await executeSyncMerge(bundle, {
      apply: true,
      backupRetentionDays: 1,
      maxBackups: 1,
      logRetentionDays: 0,
      maxLogEntries: 1
    })

    assert.equal(applyResult.mode, 'apply')
    assert.equal(applyResult.applied, true)
    assert.equal(applyResult.alreadyApplied, false)
    assert.equal(typeof applyResult.backupPath, 'string')

    const backupStat = await stat(applyResult.backupPath)
    assert.equal(backupStat.isFile(), true)

    const afterApply = await dbGet(
      `
        SELECT tasks_json, progress_json, notes_md, tasks_updated_at, progress_updated_at, notes_updated_at
        FROM prd_states
        WHERE repo_id = ? AND slug = ?
      `,
      [repo.id, slug]
    )
    assert.ok(afterApply)
    assert.equal(afterApply.notes_md, 'incoming note')

    const parsedTasks = JSON.parse(afterApply.tasks_json)
    assert.equal(parsedTasks.tasks[0]?.title, 'Incoming title')

    const parsedProgress = JSON.parse(afterApply.progress_json)
    assert.equal(parsedProgress.completed, 1)

    assert.equal(afterApply.tasks_updated_at, '2026-03-01T00:00:00.000Z')
    assert.equal(afterApply.progress_updated_at, '2026-03-01T00:00:00.000Z')
    assert.equal(afterApply.notes_updated_at, '2026-03-01T00:00:00.000Z')

    const archiveRow = await dbGet(
      'SELECT archived_at FROM prd_archives WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.equal(archiveRow.archived_at, '2026-03-01T00:00:00.000Z')

    const syncLogCount = await dbGet('SELECT COUNT(*) as count FROM sync_bundle_log')
    assert.equal(syncLogCount.count, 1)

    const backupFiles = await listBackupFiles(dbPath)
    assert.equal(backupFiles.length, 1)

    const secondApply = await executeSyncMerge(bundle, { apply: true })
    assert.equal(secondApply.applied, false)
    assert.equal(secondApply.alreadyApplied, true)

    const syncLogCountAfterReapply = await dbGet('SELECT COUNT(*) as count FROM sync_bundle_log')
    assert.equal(syncLogCountAfterReapply.count, 1)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('executeSyncMerge apply fails when unresolved mappings remain', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-apply-unresolved-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'unresolved-prd'
    const repoPath = await createRepoFixture(tempRoot, 'repo-unresolved', slug)
    await addRepo(repoPath, 'Repo Unresolved')

    const bundle = {
      type: 'steward-sync-bundle',
      formatVersion: 1,
      bundleId: 'bundle-unresolved-001',
      createdAt: '2026-03-01T00:00:00.000Z',
      sourceDeviceId: 'device-001',
      stewardVersion: '0.1.24',
      repos: [],
      states: [
        {
          repoSyncKey: 'unknown-repo-sync-key',
          slug,
          tasks: null,
          progress: null,
          notes: null,
          clocks: {
            tasksUpdatedAt: null,
            progressUpdatedAt: null,
            notesUpdatedAt: null
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

    await assert.rejects(
      () => executeSyncMerge(bundle, { apply: true }),
      /Cannot apply bundle with unresolved repositories/
    )

    const unresolvedLog = await dbGet(
      'SELECT bundle_id FROM sync_bundle_log WHERE bundle_id = ?',
      ['bundle-unresolved-001']
    )
    assert.equal(unresolvedLog, null)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
