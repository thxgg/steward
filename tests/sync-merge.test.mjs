import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dbGet, dbRun } from '../dist/server/utils/db.js'
import { upsertPrdState } from '../dist/server/utils/prd-state.js'
import { addRepo } from '../dist/server/utils/repos.js'
import { planSyncMerge } from '../dist/server/utils/sync-merge.js'
import { createSyncFieldHashes } from '../dist/server/utils/sync-schema.js'

function emptyClocks() {
  return {
    tasksUpdatedAt: null,
    progressUpdatedAt: null,
    notesUpdatedAt: null
  }
}

function emptyHashes() {
  return {
    tasksHash: null,
    progressHash: null,
    notesHash: null
  }
}

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

async function getRepoSyncMeta(repoId) {
  return await dbGet(
    `
      SELECT sync_key, fingerprint, fingerprint_kind
      FROM repo_sync_meta
      WHERE repo_id = ?
    `,
    [repoId]
  )
}

function makeSyncKey(label, repoId) {
  return `rsk-${label}-${repoId.replaceAll('-', '').slice(0, 12)}`
}

test('planSyncMerge resolves mappings with override precedence and reports unresolved repos', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-merge-map-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const repoAPath = await createRepoFixture(tempRoot, 'repo-a', 'alpha-prd')
    const repoBPath = await createRepoFixture(tempRoot, 'repo-b', 'beta-prd')
    const repoA = await addRepo(repoAPath, 'Repo A')
    const repoB = await addRepo(repoBPath, 'Repo B')

    const updatedAt = '2026-02-27T00:00:00.000Z'
    const repoASyncKey = makeSyncKey('local-a', repoA.id)
    const repoBSyncKey = makeSyncKey('local-b', repoB.id)

    await setRepoSyncKey(repoA.id, repoASyncKey, updatedAt)
    await setRepoSyncKey(repoB.id, repoBSyncKey, updatedAt)

    const repoAMeta = await getRepoSyncMeta(repoA.id)
    const repoBMeta = await getRepoSyncMeta(repoB.id)
    assert.ok(repoAMeta?.fingerprint)
    assert.ok(repoAMeta?.fingerprint_kind)
    assert.ok(repoBMeta?.fingerprint)
    assert.ok(repoBMeta?.fingerprint_kind)

    const bundle = {
      type: 'steward-sync-bundle',
      formatVersion: 1,
      bundleId: 'bundle-map-precedence',
      createdAt: updatedAt,
      sourceDeviceId: 'device-001',
      stewardVersion: '0.1.24',
      repos: [
        {
          repoSyncKey: 'incoming-override',
          name: 'Incoming Override',
          pathHint: 'override',
          fingerprint: repoBMeta.fingerprint,
          fingerprintKind: repoBMeta.fingerprint_kind
        },
        {
          repoSyncKey: repoASyncKey,
          name: 'Incoming Sync Key',
          pathHint: 'sync-key',
          fingerprint: repoAMeta.fingerprint,
          fingerprintKind: repoAMeta.fingerprint_kind
        },
        {
          repoSyncKey: 'incoming-fingerprint',
          name: 'Incoming Fingerprint',
          pathHint: 'fingerprint',
          fingerprint: repoBMeta.fingerprint,
          fingerprintKind: repoBMeta.fingerprint_kind
        }
      ],
      states: [
        { repoSyncKey: 'incoming-override', slug: 'state-override', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() },
        { repoSyncKey: repoASyncKey, slug: 'state-sync', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() },
        { repoSyncKey: 'incoming-fingerprint', slug: 'state-fingerprint', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() },
        { repoSyncKey: 'incoming-orphan', slug: 'state-orphan', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() }
      ],
      archives: []
    }

    const plan = await planSyncMerge(bundle, {
      repoMap: {
        'incoming-override': repoA.path
      }
    })

    const mappingByKey = new Map(plan.mappings.map((mapping) => [mapping.incomingRepoSyncKey, mapping]))

    assert.equal(mappingByKey.get('incoming-override')?.source, 'map')
    assert.equal(mappingByKey.get('incoming-override')?.localRepoId, repoA.id)

    assert.equal(mappingByKey.get(repoASyncKey)?.source, 'sync_key')
    assert.equal(mappingByKey.get(repoASyncKey)?.localRepoId, repoA.id)

    assert.equal(mappingByKey.get('incoming-fingerprint')?.source, 'fingerprint')
    assert.equal(mappingByKey.get('incoming-fingerprint')?.localRepoId, repoB.id)

    assert.equal(mappingByKey.get('incoming-orphan')?.source, 'unresolved')
    assert.equal(mappingByKey.get('incoming-orphan')?.reason, 'unknown_repo_metadata')

    assert.equal(plan.summary.repos.mapped, 3)
    assert.equal(plan.summary.repos.unresolved, 1)
    assert.equal(plan.summary.states.insert, 3)
    assert.equal(plan.summary.states.unresolved, 1)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('planSyncMerge computes deterministic field-level decisions without mutating local rows', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-merge-field-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const repoPath = await createRepoFixture(tempRoot, 'repo-merge', 'merge-prd')
    const repo = await addRepo(repoPath, 'Repo Merge')

    await setRepoSyncKey(repo.id, 'rsk-local-merge', '2026-02-27T00:00:00.000Z')

    const mergeRepoMeta = await getRepoSyncMeta(repo.id)
    assert.ok(mergeRepoMeta?.fingerprint)
    assert.ok(mergeRepoMeta?.fingerprint_kind)

    const slug = 'merge-prd'
    const tasks = {
      prd: {
        name: 'Merge PRD',
        source: `docs/prd/${slug}.md`,
        createdAt: '2026-02-27T00:00:00.000Z'
      },
      tasks: [
        {
          id: 'task-001',
          category: 'feature',
          title: 'Local task',
          description: 'Local task state',
          steps: ['Local step'],
          passes: ['Local pass'],
          dependencies: [],
          priority: 'high',
          status: 'pending'
        }
      ]
    }

    const localProgress = {
      prdName: 'Merge PRD',
      totalTasks: 1,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-02-27T00:00:00.000Z',
      patterns: [],
      taskLogs: []
    }

    await upsertPrdState(repo.id, slug, {
      tasks,
      progress: localProgress,
      notes: 'local-note'
    })

    await dbRun(
      `
        UPDATE prd_states
        SET
          updated_at = ?,
          tasks_updated_at = ?,
          progress_updated_at = ?,
          notes_updated_at = ?
        WHERE repo_id = ? AND slug = ?
      `,
      [
        '2026-02-28T12:00:00.000Z',
        '2026-02-26T08:00:00.000Z',
        '2026-02-27T09:00:00.000Z',
        '2026-02-28T12:00:00.000Z',
        repo.id,
        slug
      ]
    )

    await dbRun(
      'INSERT INTO prd_archives (repo_id, slug, archived_at) VALUES (?, ?, ?)',
      [repo.id, slug, '2026-02-28T12:00:00.000Z']
    )

    const beforeRow = await dbGet(
      `
        SELECT updated_at, tasks_updated_at, progress_updated_at, notes_updated_at, notes_md
        FROM prd_states
        WHERE repo_id = ? AND slug = ?
      `,
      [repo.id, slug]
    )

    const incomingProgress = {
      prdName: 'Merge PRD',
      totalTasks: 1,
      completed: 1,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-02-27T09:00:00.000Z',
      patterns: [{ name: 'sync', description: 'sync' }],
      taskLogs: []
    }

    const localProgressHash = createSyncFieldHashes({
      tasks: null,
      progress: localProgress,
      notes: null
    }).progressHash
    const incomingProgressHash = createSyncFieldHashes({
      tasks: null,
      progress: incomingProgress,
      notes: null
    }).progressHash

    const expectedProgressWinner = (incomingProgressHash || '').localeCompare(localProgressHash || '') > 0
      ? 'incoming'
      : (incomingProgressHash === localProgressHash ? 'local' : 'local')

    const bundle = {
      type: 'steward-sync-bundle',
      formatVersion: 1,
      bundleId: 'bundle-field-decisions',
      createdAt: '2026-03-01T00:00:00.000Z',
      sourceDeviceId: 'device-002',
      stewardVersion: '0.1.24',
      repos: [
        {
          repoSyncKey: 'rsk-local-merge',
          name: 'Repo Merge',
          pathHint: 'repo-merge',
          fingerprint: mergeRepoMeta.fingerprint,
          fingerprintKind: mergeRepoMeta.fingerprint_kind
        }
      ],
      states: [
        {
          repoSyncKey: 'rsk-local-merge',
          slug,
          tasks: {
            ...tasks,
            tasks: [
              {
                ...tasks.tasks[0],
                title: 'Incoming task title'
              }
            ]
          },
          progress: incomingProgress,
          notes: 'incoming-older-note',
          clocks: {
            tasksUpdatedAt: '2026-03-01T00:00:00.000Z',
            progressUpdatedAt: '2026-02-27T09:00:00.000Z',
            notesUpdatedAt: '2026-02-01T00:00:00.000Z'
          },
          hashes: emptyHashes()
        }
      ],
      archives: [
        {
          repoSyncKey: 'rsk-local-merge',
          slug,
          archivedAt: '2026-02-01T00:00:00.000Z'
        },
        {
          repoSyncKey: 'rsk-local-merge',
          slug: 'new-archive-prd',
          archivedAt: '2026-03-01T00:00:00.000Z'
        }
      ]
    }

    const plan = await planSyncMerge(bundle)

    assert.equal(plan.summary.states.update, 1)
    assert.equal(plan.summary.states.skip, 0)
    assert.equal(plan.summary.states.unresolved, 0)
    assert.equal(plan.summary.states.conflicts, 3)

    const plannedRow = plan.states[0]
    assert.ok(plannedRow)
    assert.equal(plannedRow.action, 'update')
    assert.deepEqual(plannedRow.updateFields.includes('tasks'), true)
    assert.deepEqual(plannedRow.updateFields.includes('notes'), false)

    assert.equal(plannedRow.fieldDecisions?.tasks.winner, 'incoming')
    assert.equal(plannedRow.fieldDecisions?.tasks.reason, 'incoming_newer_clock')

    assert.equal(plannedRow.fieldDecisions?.progress.winner, expectedProgressWinner)
    assert.equal(
      plannedRow.fieldDecisions?.progress.reason,
      expectedProgressWinner === 'incoming' ? 'incoming_hash_tiebreak' : (incomingProgressHash === localProgressHash ? 'equal_value' : 'local_hash_tiebreak')
    )

    assert.equal(plannedRow.fieldDecisions?.notes.winner, 'local')
    assert.equal(plannedRow.fieldDecisions?.notes.reason, 'local_newer_clock')

    assert.equal(plan.summary.archives.insert, 1)
    assert.equal(plan.summary.archives.skip, 1)

    const afterRow = await dbGet(
      `
        SELECT updated_at, tasks_updated_at, progress_updated_at, notes_updated_at, notes_md
        FROM prd_states
        WHERE repo_id = ? AND slug = ?
      `,
      [repo.id, slug]
    )

    assert.deepEqual(afterRow, beforeRow)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('planSyncMerge supports --map targets by repo id and local sync key', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-merge-map-target-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const repoAPath = await createRepoFixture(tempRoot, 'repo-map-a', 'map-a-prd')
    const repoBPath = await createRepoFixture(tempRoot, 'repo-map-b', 'map-b-prd')
    const repoA = await addRepo(repoAPath, 'Repo Map A')
    const repoB = await addRepo(repoBPath, 'Repo Map B')

    const updatedAt = '2026-02-27T00:00:00.000Z'
    const repoASyncKey = makeSyncKey('map-target-a', repoA.id)
    const repoBSyncKey = makeSyncKey('map-target-b', repoB.id)

    await setRepoSyncKey(repoA.id, repoASyncKey, updatedAt)
    await setRepoSyncKey(repoB.id, repoBSyncKey, updatedAt)

    const bundle = {
      type: 'steward-sync-bundle',
      formatVersion: 1,
      bundleId: 'bundle-map-targets',
      createdAt: updatedAt,
      sourceDeviceId: 'device-001',
      stewardVersion: '0.1.24',
      repos: [
        {
          repoSyncKey: 'incoming-map-id',
          name: 'Incoming Map Id',
          pathHint: 'incoming-id',
          fingerprint: 'unmatched-fingerprint-a',
          fingerprintKind: 'git-remotes-v1'
        },
        {
          repoSyncKey: 'incoming-map-sync',
          name: 'Incoming Map Sync Key',
          pathHint: 'incoming-sync',
          fingerprint: 'unmatched-fingerprint-b',
          fingerprintKind: 'git-remotes-v1'
        },
        {
          repoSyncKey: 'incoming-map-invalid',
          name: 'Incoming Invalid Mapping',
          pathHint: 'incoming-invalid',
          fingerprint: 'unmatched-fingerprint-c',
          fingerprintKind: 'git-remotes-v1'
        }
      ],
      states: [
        { repoSyncKey: 'incoming-map-id', slug: 'state-map-id', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() },
        { repoSyncKey: 'incoming-map-sync', slug: 'state-map-sync', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() },
        { repoSyncKey: 'incoming-map-invalid', slug: 'state-map-invalid', tasks: null, progress: null, notes: null, clocks: emptyClocks(), hashes: emptyHashes() }
      ],
      archives: []
    }

    const plan = await planSyncMerge(bundle, {
      repoMap: {
        'incoming-map-id': repoB.id,
        'incoming-map-sync': repoASyncKey,
        'incoming-map-invalid': '/tmp/non-existent-sync-repo'
      }
    })

    const mappingByKey = new Map(plan.mappings.map((mapping) => [mapping.incomingRepoSyncKey, mapping]))

    assert.equal(mappingByKey.get('incoming-map-id')?.source, 'map')
    assert.equal(mappingByKey.get('incoming-map-id')?.localRepoId, repoB.id)

    assert.equal(mappingByKey.get('incoming-map-sync')?.source, 'map')
    assert.equal(mappingByKey.get('incoming-map-sync')?.localRepoId, repoA.id)

    assert.equal(mappingByKey.get('incoming-map-invalid')?.source, 'unresolved')
    assert.equal(mappingByKey.get('incoming-map-invalid')?.reason, 'map_target_not_found')

    assert.equal(plan.summary.repos.mapped, 2)
    assert.equal(plan.summary.repos.unresolved, 1)
    assert.equal(plan.summary.states.insert, 2)
    assert.equal(plan.summary.states.unresolved, 1)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
