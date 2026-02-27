import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'

import { setPrdArchived } from '../dist/server/utils/prd-archive.js'
import { upsertPrdState } from '../dist/server/utils/prd-state.js'
import { addRepo } from '../dist/server/utils/repos.js'
import { buildSyncBundle } from '../dist/server/utils/sync-export.js'
import { createSyncFieldHashes, validateSyncBundle } from '../dist/server/utils/sync-schema.js'

async function createRepoFixture(rootDir, repoName, slug) {
  const repoPath = join(rootDir, repoName)
  const prdDir = join(repoPath, 'docs', 'prd')
  await mkdir(prdDir, { recursive: true })
  await writeFile(join(prdDir, `${slug}.md`), `# ${slug}\n`) 
  return repoPath
}

test('buildSyncBundle exports state and archives with basename path hints by default', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-export-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'sync-export-prd'
    const repoPath = await createRepoFixture(tempRoot, 'export-repo', slug)
    const repo = await addRepo(repoPath, 'Export Repo')

    const createdAt = '2026-02-27T00:00:00.000Z'
    const tasks = {
      prd: {
        name: 'Sync Export PRD',
        source: `docs/prd/${slug}.md`,
        createdAt
      },
      tasks: [
        {
          id: 'task-001',
          category: 'feature',
          title: 'Export sync bundle',
          description: 'Implement bundle export.',
          steps: ['Create export util'],
          passes: ['Bundle validates'],
          dependencies: [],
          priority: 'high',
          status: 'pending'
        }
      ]
    }

    const progress = {
      prdName: 'Sync Export PRD',
      totalTasks: 1,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: createdAt,
      patterns: [],
      taskLogs: []
    }

    await upsertPrdState(repo.id, slug, {
      tasks,
      progress,
      notes: 'initial export notes'
    })

    await setPrdArchived(repo.id, slug, true)

    const bundle = await buildSyncBundle({
      bundleId: 'bundle-default-path-hint',
      createdAt,
      stewardVersion: 'test-version',
      repoIds: [repo.id]
    })

    assert.equal(bundle.type, 'steward-sync-bundle')
    assert.equal(bundle.formatVersion, 1)
    assert.equal(bundle.bundleId, 'bundle-default-path-hint')
    assert.equal(bundle.repos.length, 1)

    const exportedRepo = bundle.repos[0]
    assert.equal(exportedRepo.name, 'Export Repo')
    assert.equal(exportedRepo.pathHint, basename(repoPath))

    assert.equal(bundle.states.length, 1)
    const stateRow = bundle.states[0]
    assert.equal(stateRow.slug, slug)
    assert.equal(stateRow.tasks?.prd?.name, 'Sync Export PRD')
    assert.equal(stateRow.progress?.prdName, 'Sync Export PRD')
    assert.equal(stateRow.notes, 'initial export notes')
    assert.equal(typeof stateRow.clocks.tasksUpdatedAt, 'string')
    assert.equal(typeof stateRow.clocks.progressUpdatedAt, 'string')
    assert.equal(typeof stateRow.clocks.notesUpdatedAt, 'string')

    const expectedHashes = createSyncFieldHashes({
      tasks: stateRow.tasks,
      progress: stateRow.progress,
      notes: stateRow.notes
    })
    assert.deepEqual(stateRow.hashes, expectedHashes)

    assert.equal(bundle.archives.length, 1)
    assert.equal(bundle.archives[0]?.slug, slug)

    const validation = validateSyncBundle(bundle)
    assert.equal(validation.success, true)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('buildSyncBundle supports none and absolute path hint modes', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-export-path-mode-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'sync-export-path-mode'
    const repoPath = await createRepoFixture(tempRoot, 'path-mode-repo', slug)
    const repo = await addRepo(repoPath, 'Path Mode Repo')

    await upsertPrdState(repo.id, slug, {
      tasks: {
        prd: {
          name: 'Path Mode PRD',
          source: `docs/prd/${slug}.md`,
          createdAt: '2026-02-27T00:00:00.000Z'
        },
        tasks: []
      },
      progress: {
        prdName: 'Path Mode PRD',
        totalTasks: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        startedAt: null,
        lastUpdated: '2026-02-27T00:00:00.000Z',
        patterns: [],
        taskLogs: []
      }
    })

    const noneBundle = await buildSyncBundle({
      bundleId: 'bundle-none-path-hint',
      createdAt: '2026-02-27T00:00:00.000Z',
      stewardVersion: 'test-version',
      pathHints: 'none',
      repoIds: [repo.id]
    })

    assert.equal(noneBundle.repos.length, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(noneBundle.repos[0], 'pathHint'), false)

    const absoluteBundle = await buildSyncBundle({
      bundleId: 'bundle-absolute-path-hint',
      createdAt: '2026-02-27T00:00:00.000Z',
      stewardVersion: 'test-version',
      pathHints: 'absolute',
      repoIds: [repo.id]
    })

    assert.equal(absoluteBundle.repos.length, 1)
    assert.equal(absoluteBundle.repos[0]?.pathHint, resolve(repoPath))
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
