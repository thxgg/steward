import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'

import { dbGet } from '../dist/server/utils/db.js'
import { upsertPrdState } from '../dist/server/utils/prd-state.js'
import { addRepo } from '../dist/server/utils/repos.js'
import {
  parseSyncExportArgs,
  parseSyncInspectArgs,
  parseSyncMergeArgs,
  runSync
} from '../dist/host/src/sync.js'

async function createRepoFixture(rootDir, repoName, slug) {
  const repoPath = join(rootDir, repoName)
  const prdDir = join(repoPath, 'docs', 'prd')
  await mkdir(prdDir, { recursive: true })
  await writeFile(join(prdDir, `${slug}.md`), `# ${slug}\n`)
  return repoPath
}

test('sync CLI argument parsing enforces defaults and flag rules', () => {
  const exportParsed = parseSyncExportArgs(['bundle.json', '--path-hints', 'none'])
  assert.equal(exportParsed.bundlePath, resolve(process.cwd(), 'bundle.json'))
  assert.equal(exportParsed.pathHints, 'none')

  const inspectParsed = parseSyncInspectArgs(['bundle.json'])
  assert.equal(inspectParsed.bundlePath, resolve(process.cwd(), 'bundle.json'))

  const mergeDefault = parseSyncMergeArgs(['bundle.json'])
  assert.equal(mergeDefault.bundlePath, resolve(process.cwd(), 'bundle.json'))
  assert.equal(mergeDefault.apply, false)
  assert.deepEqual(mergeDefault.repoMap, {})

  const mergeMapped = parseSyncMergeArgs([
    'bundle.json',
    '--apply',
    '--map',
    'incoming-key=/tmp/local-repo'
  ])
  assert.equal(mergeMapped.apply, true)
  assert.deepEqual(mergeMapped.repoMap, {
    'incoming-key': '/tmp/local-repo'
  })

  assert.throws(() => parseSyncMergeArgs(['bundle.json', '--apply', '--dry-run']), /Cannot use --apply and --dry-run together/)
  assert.throws(() => parseSyncExportArgs(['bundle.json', '--path-hints', 'invalid']), /Invalid --path-hints value/)
  assert.throws(() => parseSyncInspectArgs(['bundle.json', 'extra']), /requires exactly one/) 
})

test('sync CLI export inspect and merge default to dry-run', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-cli-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'sync-cli-prd'
    const repoPath = await createRepoFixture(tempRoot, 'repo-sync-cli', slug)
    const repo = await addRepo(repoPath, 'Sync CLI Repo')

    await upsertPrdState(repo.id, slug, {
      tasks: {
        prd: {
          name: 'Sync CLI PRD',
          source: `docs/prd/${slug}.md`,
          createdAt: '2026-02-27T00:00:00.000Z'
        },
        tasks: []
      },
      progress: {
        prdName: 'Sync CLI PRD',
        totalTasks: 0,
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

    const exportPath = join(tempRoot, 'bundle.json')
    const exportCode = await runSync(['export', exportPath])
    assert.equal(exportCode, 0)

    const exported = JSON.parse(await readFile(exportPath, 'utf-8'))
    assert.equal(exported.repos.length, 1)
    assert.equal(exported.repos[0].pathHint, basename(repoPath))

    const inspectCode = await runSync(['inspect', exportPath])
    assert.equal(inspectCode, 0)

    const mergeBundle = JSON.parse(await readFile(exportPath, 'utf-8'))
    mergeBundle.bundleId = 'bundle-cli-merge-001'
    mergeBundle.states[0].notes = 'incoming note'
    mergeBundle.states[0].clocks.notesUpdatedAt = '2099-01-01T00:00:00.000Z'
    const mergePath = join(tempRoot, 'bundle-merge.json')
    await writeFile(mergePath, JSON.stringify(mergeBundle, null, 2))

    const dryRunCode = await runSync(['merge', mergePath])
    assert.equal(dryRunCode, 0)

    const afterDryRun = await dbGet(
      'SELECT notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.equal(afterDryRun.notes_md, 'local note')

    const applyCode = await runSync(['merge', mergePath, '--apply'])
    assert.equal(applyCode, 0)

    const afterApply = await dbGet(
      'SELECT notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.equal(afterApply.notes_md, 'incoming note')
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('sync CLI merge apply fails unresolved and accepts --map overrides', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-cli-map-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const slug = 'sync-cli-map-prd'
    const repoPath = await createRepoFixture(tempRoot, 'repo-sync-map', slug)
    const repo = await addRepo(repoPath, 'Sync CLI Map Repo')

    await upsertPrdState(repo.id, slug, {
      tasks: {
        prd: {
          name: 'Sync CLI Map PRD',
          source: `docs/prd/${slug}.md`,
          createdAt: '2026-02-27T00:00:00.000Z'
        },
        tasks: []
      },
      progress: {
        prdName: 'Sync CLI Map PRD',
        totalTasks: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        startedAt: null,
        lastUpdated: '2026-02-27T00:00:00.000Z',
        patterns: [],
        taskLogs: []
      },
      notes: 'map local note'
    })

    const exportPath = join(tempRoot, 'bundle-map-base.json')
    await runSync(['export', exportPath])

    const exported = JSON.parse(await readFile(exportPath, 'utf-8'))
    const targetState = exported.states.find((state) => state.slug === slug)
    assert.ok(targetState)

    const targetRepo = exported.repos.find((repoRow) => repoRow.repoSyncKey === targetState.repoSyncKey)
    assert.ok(targetRepo)

    const unresolvedBundle = {
      ...exported,
      bundleId: 'bundle-cli-map-001',
      repos: [
        {
          ...targetRepo,
          repoSyncKey: 'incoming-mapped',
          fingerprint: 'fingerprint-unmatched',
          fingerprintKind: 'git-remotes-v1'
        }
      ],
      states: [
        {
          ...targetState,
          repoSyncKey: 'incoming-mapped',
          notes: 'mapped incoming note',
          clocks: {
            ...targetState.clocks,
            notesUpdatedAt: '2099-01-01T00:00:00.000Z'
          }
        }
      ],
      archives: []
    }

    const unresolvedPath = join(tempRoot, 'bundle-map.json')
    await writeFile(unresolvedPath, JSON.stringify(unresolvedBundle, null, 2))

    await assert.rejects(
      () => runSync(['merge', unresolvedPath, '--apply']),
      /Cannot apply bundle with unresolved repositories/
    )

    const mappedApplyCode = await runSync([
      'merge',
      unresolvedPath,
      '--apply',
      '--map',
      `incoming-mapped=${repo.path}`
    ])
    assert.equal(mappedApplyCode, 0)

    const afterMapApply = await dbGet(
      'SELECT notes_md FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, slug]
    )
    assert.equal(afterMapApply.notes_md, 'mapped incoming note')
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
