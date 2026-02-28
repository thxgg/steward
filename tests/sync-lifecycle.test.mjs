import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createSyncFieldHashes } from '../dist/server/utils/sync-schema.js'

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_FILE_DIR, '..')

async function createRepoFixture(rootPath, repoName, slug) {
  const repoPath = join(rootPath, repoName)
  await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })
  await writeFile(join(repoPath, 'docs', 'prd', `${slug}.md`), `# ${slug}\n`)
  return repoPath
}

function runModuleJson(dbPath, code) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PRD_STATE_DB_PATH: dbPath
    },
    encoding: 'utf-8'
  })

  return JSON.parse(output)
}

test('export-merge lifecycle supports cross-path sync key mapping, field conflicts, and idempotent reapply', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-lifecycle-test-'))

  try {
    const sourceDbPath = join(tempRoot, 'source.db')
    const targetDbPath = join(tempRoot, 'target.db')
    const slug = 'sync-lifecycle-prd'
    const sharedSyncKey = 'rsk-shared-sync-lifecycle'

    const sourceRepoPath = await createRepoFixture(join(tempRoot, 'source-device'), 'repo-source', slug)
    const targetRepoPath = await createRepoFixture(join(tempRoot, 'target-device'), 'repo-target', slug)

    const incomingProgress = {
      prdName: 'Sync Lifecycle PRD',
      totalTasks: 1,
      completed: 1,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-03-06T00:00:00.000Z',
      patterns: [{ name: 'incoming', description: 'incoming' }],
      taskLogs: []
    }

    const localProgress = {
      prdName: 'Sync Lifecycle PRD',
      totalTasks: 1,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-03-06T00:00:00.000Z',
      patterns: [{ name: 'local', description: 'local' }],
      taskLogs: []
    }

    const incomingProgressHash = createSyncFieldHashes({
      tasks: null,
      progress: incomingProgress,
      notes: null
    }).progressHash

    const localProgressHash = createSyncFieldHashes({
      tasks: null,
      progress: localProgress,
      notes: null
    }).progressHash

    const expectedProgressWinner = (incomingProgressHash || '').localeCompare(localProgressHash || '') > 0
      ? 'incoming'
      : 'local'

    const sourceSetup = runModuleJson(
      sourceDbPath,
      `
        import { addRepo } from './dist/server/utils/repos.js'
        import { upsertPrdState } from './dist/server/utils/prd-state.js'
        import { dbRun } from './dist/server/utils/db.js'
        import { buildSyncBundle } from './dist/server/utils/sync-export.js'

        const slug = ${JSON.stringify(slug)}
        const repoPath = ${JSON.stringify(sourceRepoPath)}
        const syncKey = ${JSON.stringify(sharedSyncKey)}

        const repo = await addRepo(repoPath, 'Source Repo')

        await upsertPrdState(repo.id, slug, {
          tasks: {
            prd: {
              name: 'Sync Lifecycle PRD',
              source: 'docs/prd/sync-lifecycle-prd.md',
              createdAt: '2026-03-01T00:00:00.000Z'
            },
            tasks: [
              {
                id: 'task-001',
                category: 'feature',
                title: 'Incoming title',
                description: 'Incoming description',
                steps: ['Incoming step'],
                passes: ['Incoming pass'],
                dependencies: [],
                priority: 'high',
                status: 'pending'
              }
            ]
          },
          progress: ${JSON.stringify(incomingProgress)},
          notes: 'incoming older note'
        })

        await dbRun(
          'UPDATE repo_sync_meta SET sync_key = ?, updated_at = ? WHERE repo_id = ?',
          [syncKey, '2026-03-20T00:00:00.000Z', repo.id]
        )

        await dbRun(
          \
          'UPDATE prd_states SET tasks_updated_at = ?, progress_updated_at = ?, notes_updated_at = ?, updated_at = ? WHERE repo_id = ? AND slug = ?',
          ['2026-03-05T00:00:00.000Z', '2026-03-06T00:00:00.000Z', '2026-03-02T00:00:00.000Z', '2026-03-05T00:00:00.000Z', repo.id, slug]
        )

        await dbRun(
          'INSERT INTO prd_archives (repo_id, slug, archived_at) VALUES (?, ?, ?)',
          [repo.id, slug, '2026-03-08T00:00:00.000Z']
        )

        const bundle = await buildSyncBundle({
          bundleId: 'bundle-lifecycle-001',
          createdAt: '2026-03-20T00:00:00.000Z',
          stewardVersion: 'test-version',
          repoIds: [repo.id]
        })

        process.stdout.write(JSON.stringify({ bundle }))
      `
    )

    const bundle = sourceSetup.bundle

    const targetSetup = runModuleJson(
      targetDbPath,
      `
        import { addRepo } from './dist/server/utils/repos.js'
        import { upsertPrdState } from './dist/server/utils/prd-state.js'
        import { dbRun } from './dist/server/utils/db.js'

        const slug = ${JSON.stringify(slug)}
        const repoPath = ${JSON.stringify(targetRepoPath)}
        const syncKey = ${JSON.stringify(sharedSyncKey)}

        const repo = await addRepo(repoPath, 'Target Repo')

        await upsertPrdState(repo.id, slug, {
          tasks: {
            prd: {
              name: 'Sync Lifecycle PRD',
              source: 'docs/prd/sync-lifecycle-prd.md',
              createdAt: '2026-03-01T00:00:00.000Z'
            },
            tasks: [
              {
                id: 'task-001',
                category: 'feature',
                title: 'Local title',
                description: 'Local description',
                steps: ['Local step'],
                passes: ['Local pass'],
                dependencies: [],
                priority: 'high',
                status: 'pending'
              }
            ]
          },
          progress: ${JSON.stringify(localProgress)},
          notes: 'local newer note'
        })

        await dbRun(
          'UPDATE repo_sync_meta SET sync_key = ?, updated_at = ? WHERE repo_id = ?',
          [syncKey, '2026-03-20T00:00:00.000Z', repo.id]
        )

        await dbRun(
          'UPDATE prd_states SET tasks_updated_at = ?, progress_updated_at = ?, notes_updated_at = ?, updated_at = ? WHERE repo_id = ? AND slug = ?',
          ['2026-03-01T00:00:00.000Z', '2026-03-06T00:00:00.000Z', '2026-03-15T00:00:00.000Z', '2026-03-15T00:00:00.000Z', repo.id, slug]
        )

        await dbRun(
          'INSERT INTO prd_archives (repo_id, slug, archived_at) VALUES (?, ?, ?)',
          [repo.id, slug, '2026-03-01T00:00:00.000Z']
        )

        process.stdout.write(JSON.stringify({ repoId: repo.id }))
      `
    )

    const mergeResult = runModuleJson(
      targetDbPath,
      `
        import { executeSyncMerge } from './dist/server/utils/sync-apply.js'
        import { dbGet } from './dist/server/utils/db.js'

        const bundle = ${JSON.stringify(bundle)}
        const repoId = ${JSON.stringify(targetSetup.repoId)}
        const slug = ${JSON.stringify(slug)}

        const before = await dbGet(
          'SELECT tasks_json, progress_json, notes_md, tasks_updated_at, progress_updated_at, notes_updated_at FROM prd_states WHERE repo_id = ? AND slug = ?',
          [repoId, slug]
        )

        const dryRun = await executeSyncMerge(bundle, { apply: false })

        const afterDryRun = await dbGet(
          'SELECT tasks_json, progress_json, notes_md, tasks_updated_at, progress_updated_at, notes_updated_at FROM prd_states WHERE repo_id = ? AND slug = ?',
          [repoId, slug]
        )

        const firstApply = await executeSyncMerge(bundle, { apply: true })

        const afterApply = await dbGet(
          'SELECT tasks_json, progress_json, notes_md, tasks_updated_at, progress_updated_at, notes_updated_at FROM prd_states WHERE repo_id = ? AND slug = ?',
          [repoId, slug]
        )

        const archiveAfterApply = await dbGet(
          'SELECT archived_at FROM prd_archives WHERE repo_id = ? AND slug = ?',
          [repoId, slug]
        )

        const secondApply = await executeSyncMerge(bundle, { apply: true })

        const bundleLogCount = await dbGet(
          'SELECT COUNT(*) as count FROM sync_bundle_log WHERE bundle_id = ?',
          [bundle.bundleId]
        )

        process.stdout.write(JSON.stringify({
          dryRun,
          firstApply,
          secondApply,
          before,
          afterDryRun,
          afterApply,
          archiveAfterApply,
          bundleLogCount: bundleLogCount?.count || 0
        }))
      `
    )

    assert.equal(mergeResult.dryRun.mode, 'dry_run')
    assert.equal(mergeResult.dryRun.applied, false)
    assert.equal(mergeResult.dryRun.plan.summary.states.update, 1)
    assert.equal(mergeResult.dryRun.plan.summary.archives.update, 1)
    assert.equal(mergeResult.dryRun.plan.mappings[0]?.source, 'sync_key')
    assert.equal(mergeResult.dryRun.plan.mappings[0]?.localRepoPath, targetRepoPath)

    assert.deepEqual(mergeResult.afterDryRun, mergeResult.before)

    assert.equal(mergeResult.firstApply.mode, 'apply')
    assert.equal(mergeResult.firstApply.applied, true)
    assert.equal(mergeResult.firstApply.alreadyApplied, false)
    assert.equal(typeof mergeResult.firstApply.backupPath, 'string')
    const backupStat = await stat(mergeResult.firstApply.backupPath)
    assert.equal(backupStat.isFile(), true)

    const tasksAfterApply = JSON.parse(mergeResult.afterApply.tasks_json)
    const progressAfterApply = JSON.parse(mergeResult.afterApply.progress_json)

    assert.equal(tasksAfterApply.tasks[0]?.title, 'Incoming title')
    assert.equal(mergeResult.afterApply.notes_md, 'local newer note')

    if (expectedProgressWinner === 'incoming') {
      assert.deepEqual(progressAfterApply.patterns, [{ name: 'incoming', description: 'incoming' }])
    } else {
      assert.deepEqual(progressAfterApply.patterns, [{ name: 'local', description: 'local' }])
    }

    assert.equal(mergeResult.afterApply.tasks_updated_at, '2026-03-05T00:00:00.000Z')
    assert.equal(mergeResult.afterApply.progress_updated_at, '2026-03-06T00:00:00.000Z')
    assert.equal(mergeResult.afterApply.notes_updated_at, '2026-03-15T00:00:00.000Z')
    assert.equal(mergeResult.archiveAfterApply.archived_at, '2026-03-08T00:00:00.000Z')

    assert.equal(mergeResult.secondApply.mode, 'apply')
    assert.equal(mergeResult.secondApply.applied, false)
    assert.equal(mergeResult.secondApply.alreadyApplied, true)
    assert.equal(mergeResult.bundleLogCount, 1)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('export-merge lifecycle supports explicit map for unmatched repo sync keys', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-lifecycle-map-test-'))

  try {
    const sourceDbPath = join(tempRoot, 'source-map.db')
    const targetDbPath = join(tempRoot, 'target-map.db')
    const slug = 'sync-lifecycle-map-prd'

    const sourceRepoPath = await createRepoFixture(join(tempRoot, 'source-map-device'), 'repo-map-source', slug)
    const targetRepoPath = await createRepoFixture(join(tempRoot, 'target-map-device'), 'repo-map-target', slug)

    const sourceBundle = runModuleJson(
      sourceDbPath,
      `
        import { addRepo } from './dist/server/utils/repos.js'
        import { upsertPrdState } from './dist/server/utils/prd-state.js'
        import { dbRun } from './dist/server/utils/db.js'
        import { buildSyncBundle } from './dist/server/utils/sync-export.js'

        const slug = ${JSON.stringify(slug)}
        const repo = await addRepo(${JSON.stringify(sourceRepoPath)}, 'Source Map Repo')

        await upsertPrdState(repo.id, slug, {
          tasks: {
            prd: {
              name: 'Sync Lifecycle Map PRD',
              source: 'docs/prd/sync-lifecycle-map-prd.md',
              createdAt: '2026-03-01T00:00:00.000Z'
            },
            tasks: []
          },
          progress: {
            prdName: 'Sync Lifecycle Map PRD',
            totalTasks: 0,
            completed: 0,
            inProgress: 0,
            blocked: 0,
            startedAt: null,
            lastUpdated: '2026-03-01T00:00:00.000Z',
            patterns: [],
            taskLogs: []
          },
          notes: 'incoming mapped note'
        })

        await dbRun(
          'UPDATE repo_sync_meta SET sync_key = ?, updated_at = ? WHERE repo_id = ?',
          ['rsk-source-map-only', '2026-03-20T00:00:00.000Z', repo.id]
        )

        await dbRun(
          'UPDATE prd_states SET notes_updated_at = ?, updated_at = ? WHERE repo_id = ? AND slug = ?',
          ['2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', repo.id, slug]
        )

        const bundle = await buildSyncBundle({
          bundleId: 'bundle-lifecycle-map-001',
          createdAt: '2026-03-20T00:00:00.000Z',
          stewardVersion: 'test-version',
          repoIds: [repo.id]
        })

        process.stdout.write(JSON.stringify({ bundle }))
      `
    )

    const targetSetup = runModuleJson(
      targetDbPath,
      `
        import { addRepo } from './dist/server/utils/repos.js'
        import { upsertPrdState } from './dist/server/utils/prd-state.js'
        import { dbRun } from './dist/server/utils/db.js'

        const slug = ${JSON.stringify(slug)}
        const repo = await addRepo(${JSON.stringify(targetRepoPath)}, 'Target Map Repo')

        await upsertPrdState(repo.id, slug, {
          tasks: {
            prd: {
              name: 'Sync Lifecycle Map PRD',
              source: 'docs/prd/sync-lifecycle-map-prd.md',
              createdAt: '2026-03-01T00:00:00.000Z'
            },
            tasks: []
          },
          progress: {
            prdName: 'Sync Lifecycle Map PRD',
            totalTasks: 0,
            completed: 0,
            inProgress: 0,
            blocked: 0,
            startedAt: null,
            lastUpdated: '2026-03-01T00:00:00.000Z',
            patterns: [],
            taskLogs: []
          },
          notes: 'target local note'
        })

        await dbRun(
          'UPDATE prd_states SET notes_updated_at = ?, updated_at = ? WHERE repo_id = ? AND slug = ?',
          ['2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', repo.id, slug]
        )

        process.stdout.write(JSON.stringify({ repoId: repo.id, repoPath: repo.path }))
      `
    )

    const mergeResult = runModuleJson(
      targetDbPath,
      `
        import { executeSyncMerge } from './dist/server/utils/sync-apply.js'
        import { dbGet } from './dist/server/utils/db.js'

        const bundle = ${JSON.stringify(sourceBundle.bundle)}
        const slug = ${JSON.stringify(slug)}
        const repoId = ${JSON.stringify(targetSetup.repoId)}
        const mapTargetPath = ${JSON.stringify(targetSetup.repoPath)}

        let unresolvedError = null
        try {
          await executeSyncMerge(bundle, { apply: true })
        } catch (error) {
          unresolvedError = error instanceof Error ? error.message : String(error)
        }

        const mappedApply = await executeSyncMerge(bundle, {
          apply: true,
          repoMap: {
            'rsk-source-map-only': mapTargetPath
          }
        })

        const updatedRow = await dbGet(
          'SELECT notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
          [repoId, slug]
        )

        process.stdout.write(JSON.stringify({ unresolvedError, mappedApply, updatedRow }))
      `
    )

    assert.match(mergeResult.unresolvedError || '', /Cannot apply bundle with unresolved repositories/)
    assert.equal(mergeResult.mappedApply.applied, true)
    assert.equal(mergeResult.mappedApply.alreadyApplied, false)
    assert.equal(mergeResult.updatedRow.notes_md, 'incoming mapped note')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
