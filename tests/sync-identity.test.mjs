import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_FILE_DIR, '..')

async function createPrdRepo(rootPath, repoName, slugs) {
  const repoPath = join(rootPath, repoName)
  const prdPath = join(repoPath, 'docs', 'prd')
  await mkdir(prdPath, { recursive: true })

  for (const slug of slugs) {
    await writeFile(join(prdPath, `${slug}.md`), `# ${slug}\n`)
  }

  return repoPath
}

function runModuleScript(dbPath, code) {
  execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PRD_STATE_DB_PATH: dbPath
    },
    stdio: 'pipe'
  })
}

test('registered repositories get sync keys with deterministic unchanged fingerprints', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-identity-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  const dbPath = join(tempRoot, 'state.db')
  process.env.PRD_STATE_DB_PATH = dbPath

  try {
    const repoOnePath = await createPrdRepo(tempRoot, 'repo-one', ['a-prd', 'b-prd'])
    const repoTwoPath = await createPrdRepo(tempRoot, 'repo-two', ['c-prd'])

    const { addRepo, getRepos } = await import('../dist/server/utils/repos.js')

    await addRepo(repoOnePath, 'Repo One')
    await addRepo(repoTwoPath, 'Repo Two')
    const reposBefore = await getRepos()

    const db = new DatabaseSync(dbPath)
    const firstRows = db.prepare(
      'SELECT repo_id, sync_key, fingerprint, fingerprint_kind FROM repo_sync_meta ORDER BY repo_id'
    ).all()

    assert.equal(firstRows.length, reposBefore.length)

    const firstByRepo = new Map(firstRows.map((row) => [row.repo_id, row]))

    const syncKeys = new Set()
    for (const row of firstRows) {
      assert.equal(typeof row.sync_key, 'string')
      assert.equal(row.sync_key.startsWith('rsk_'), true)
      assert.equal(typeof row.fingerprint, 'string')
      assert.equal(row.fingerprint.length > 0, true)
      assert.equal(typeof row.fingerprint_kind, 'string')
      assert.equal(row.fingerprint_kind.length > 0, true)
      syncKeys.add(row.sync_key)
    }
    assert.equal(syncKeys.size, firstRows.length)

    await getRepos()

    const secondRows = db.prepare(
      'SELECT repo_id, sync_key, fingerprint, fingerprint_kind FROM repo_sync_meta ORDER BY repo_id'
    ).all()

    assert.equal(secondRows.length, firstRows.length)

    for (const row of secondRows) {
      const before = firstByRepo.get(row.repo_id)
      assert.ok(before)
      assert.equal(row.sync_key, before.sync_key)
      assert.equal(row.fingerprint, before.fingerprint)
      assert.equal(row.fingerprint_kind, before.fingerprint_kind)
    }

    db.close()
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('sync device id persists across process restarts', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-device-id-test-'))
  const dbPath = join(tempRoot, 'state.db')
  const repoPath = await createPrdRepo(tempRoot, 'repo-device', ['device-prd'])

  try {
    runModuleScript(
      dbPath,
      `
        import { addRepo } from './dist/server/utils/repos.js';
        await addRepo(${JSON.stringify(repoPath)}, 'Device Repo');
      `
    )

    const db = new DatabaseSync(dbPath)

    const firstRow = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('sync:device-id')
    assert.ok(firstRow)
    assert.equal(typeof firstRow.value, 'string')
    assert.equal(firstRow.value.length > 0, true)

    runModuleScript(
      dbPath,
      `
        import { getRepos } from './dist/server/utils/repos.js';
        await getRepos();
      `
    )

    const secondRow = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('sync:device-id')
    assert.ok(secondRow)
    assert.equal(secondRow.value, firstRow.value)

    db.close()
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('calculateRepoFingerprint fallback is deterministic and changes with repo shape', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-fingerprint-test-'))

  try {
    const repoPath = await createPrdRepo(tempRoot, 'repo-shape', ['alpha-prd', 'beta-prd'])
    const { calculateRepoFingerprint } = await import('../dist/server/utils/sync-identity.js')

    const repo = {
      id: 'repo-shape-id',
      name: 'Repo Shape',
      path: repoPath,
      addedAt: '2026-02-27T00:00:00.000Z',
      gitRepos: []
    }

    const first = await calculateRepoFingerprint(repo)
    const second = await calculateRepoFingerprint(repo)

    assert.equal(first.fingerprintKind, 'repo-shape-v1')
    assert.equal(second.fingerprintKind, 'repo-shape-v1')
    assert.equal(first.fingerprint, second.fingerprint)

    await writeFile(join(repoPath, 'docs', 'prd', 'gamma-prd.md'), '# gamma-prd\n')

    const third = await calculateRepoFingerprint(repo)
    assert.equal(third.fingerprintKind, 'repo-shape-v1')
    assert.notEqual(third.fingerprint, first.fingerprint)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
