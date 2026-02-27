import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('state migration normalizes root commit repo aliases', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-commit-repo-migration-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { dbGet, dbRun } = await import('../dist/server/utils/db.js')
    const { startStateMigration } = await import('../dist/server/utils/state-migration.js')

    const repoPath = join(tempRoot, 'code-hospitality-monorepo')
    await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })

    const repo = await addRepo(repoPath, 'code-hospitality-monorepo')
    const now = new Date().toISOString()

    await dbRun(
      `
        INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        repo.id,
        'database-schema-optimization-in-scope-execution',
        JSON.stringify({
          prd: {
            name: 'Database Schema Optimization In-Scope Execution',
            source: 'docs/prd/database-schema-optimization-in-scope-execution.md',
            createdAt: now
          },
          tasks: []
        }),
        JSON.stringify({
          prdName: 'Database Schema Optimization In-Scope Execution',
          totalTasks: 1,
          completed: 1,
          inProgress: 0,
          blocked: 0,
          startedAt: now,
          lastUpdated: now,
          patterns: [],
          taskLogs: [
            {
              taskId: 'task-002',
              status: 'completed',
              startedAt: now,
              completedAt: now,
              commits: [
                { sha: 'abc1234', repo: 'code-hospitality-monorepo' },
                { sha: 'def4567', repo: './' },
                { sha: 'fedcba9', repo: '' }
              ]
            }
          ]
        }),
        null,
        now
      ]
    )

    await startStateMigration()

    const migratedRow = await dbGet(
      'SELECT progress_json, progress_updated_at FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, 'database-schema-optimization-in-scope-execution']
    )

    const progress = JSON.parse(migratedRow.progress_json)
    assert.deepEqual(progress.taskLogs[0].commits, [
      { sha: 'abc1234', repo: '' },
      { sha: 'def4567', repo: '' },
      { sha: 'fedcba9', repo: '' }
    ])
    assert.equal(typeof migratedRow.progress_updated_at, 'string')
    assert.equal(migratedRow.progress_updated_at.length > 0, true)

    const marker = await dbGet('SELECT value FROM app_meta WHERE key = ?', ['state-migration:commit-repo-ref-v1'])
    assert.ok(marker)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
