import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_FILE_DIR, '..')

function createLegacyStateDb(dbPath) {
  const db = new DatabaseSync(dbPath)

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL,
      git_repos_json TEXT
    );

    CREATE TABLE prd_states (
      repo_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      tasks_json TEXT,
      progress_json TEXT,
      notes_md TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (repo_id, slug),
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE prd_archives (
      repo_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      PRIMARY KEY (repo_id, slug),
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const updatedAt = '2026-02-27T00:00:00.000Z'

  db.prepare('INSERT INTO repos (id, name, path, added_at, git_repos_json) VALUES (?, ?, ?, ?, ?)').run(
    'repo-1',
    'Legacy Repo',
    '/tmp/legacy-repo',
    updatedAt,
    null
  )

  db.prepare(
    'INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    'repo-1',
    'legacy-slug',
    JSON.stringify({
      prd: {
        name: 'Legacy PRD',
        source: 'docs/prd/legacy-slug.md',
        createdAt: updatedAt
      },
      tasks: []
    }),
    JSON.stringify({
      prdName: 'Legacy PRD',
      totalTasks: 0,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: updatedAt,
      patterns: [],
      taskLogs: []
    }),
    'legacy notes',
    updatedAt
  )

  db.close()
}

function runDbProbe(dbPath, dbModuleUrl) {
  const script = `
    import { dbAll, dbGet } from ${JSON.stringify(dbModuleUrl)};

    const columns = await dbAll('PRAGMA table_info(prd_states)');
    const tableRows = await dbAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('repo_sync_meta', 'sync_bundle_log') ORDER BY name ASC");
    const stateRow = await dbGet(
      'SELECT updated_at, tasks_updated_at, progress_updated_at, notes_updated_at FROM prd_states WHERE repo_id = ? AND slug = ?',
      ['repo-1', 'legacy-slug']
    );

    process.stdout.write(JSON.stringify({
      columnNames: columns.map((column) => column.name),
      tableNames: tableRows.map((row) => row.name),
      stateRow
    }));
  `

  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PRD_STATE_DB_PATH: dbPath
      },
      encoding: 'utf-8'
    }
  )

  return JSON.parse(output)
}

test('db initialization migrates legacy schema with sync tables and field clock backfill idempotently', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-sync-db-schema-test-'))
  const dbPath = join(tempRoot, 'state.db')

  try {
    createLegacyStateDb(dbPath)

    const dbModuleUrl = pathToFileURL(join(REPO_ROOT, 'dist', 'server', 'utils', 'db.js')).href

    const first = runDbProbe(dbPath, dbModuleUrl)
    const second = runDbProbe(dbPath, dbModuleUrl)

    const requiredColumns = ['tasks_updated_at', 'progress_updated_at', 'notes_updated_at']
    for (const columnName of requiredColumns) {
      assert.equal(first.columnNames.includes(columnName), true)
      assert.equal(second.columnNames.includes(columnName), true)
    }

    assert.deepEqual(first.tableNames, ['repo_sync_meta', 'sync_bundle_log'])
    assert.deepEqual(second.tableNames, ['repo_sync_meta', 'sync_bundle_log'])

    assert.ok(first.stateRow)
    assert.equal(first.stateRow.tasks_updated_at, first.stateRow.updated_at)
    assert.equal(first.stateRow.progress_updated_at, first.stateRow.updated_at)
    assert.equal(first.stateRow.notes_updated_at, first.stateRow.updated_at)

    assert.deepEqual(second.stateRow, first.stateRow)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
