import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('one-time state migration rewrites legacy progress rows', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-migration-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { dbGet, dbRun } = await import('../dist/server/utils/db.js')
    const { getStateMigrationStatus, startStateMigration } = await import('../dist/server/utils/state-migration.js')

    const repoPath = join(tempRoot, 'repo')
    await mkdir(repoPath, { recursive: true })

    const repo = await addRepo(repoPath, 'Migration Repo')

    const now = new Date().toISOString()

    const row1Tasks = {
      prd: {
        name: 'Admin Portal Push Notifications MVP',
        source: 'docs/prd/admin-portal-push-notifications-mvp.md',
        createdAt: now
      },
      tasks: Array.from({ length: 11 }, (_, index) => ({
        id: `task-${index + 1}`,
        category: 'feature',
        title: `Task ${index + 1}`,
        description: 'desc',
        steps: [],
        passes: [],
        dependencies: [],
        priority: 'medium',
        status: 'pending'
      }))
    }

    const row1Progress = {
      prdName: 'Admin Portal Push Notifications MVP',
      totalTasks: 11,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-02-19T12:00:00Z',
      taskProgress: {}
    }

    const row2Tasks = {
      prd: {
        name: 'Mobile Logs Relay Migration and Secrets Remediation (Codebase Only)',
        source: 'docs/prd/mobile-logs-relay-secrets-remediation.md',
        createdAt: now
      },
      tasks: Array.from({ length: 14 }, (_, index) => ({
        id: `task-${String(index + 1).padStart(3, '0')}`,
        category: 'feature',
        title: `Task ${index + 1}`,
        description: 'desc',
        steps: [],
        passes: [],
        dependencies: [],
        priority: 'medium',
        status: 'pending'
      }))
    }

    const row2Progress = {
      prdName: 'Mobile Logs Relay Migration and Secrets Remediation (Codebase Only)',
      started: '2026-02-23T18:05:29Z',
      patterns: ['Prefer helper reuse'],
      taskLogs: [],
      inProgress: null,
      lastUpdated: '2026-02-23T18:20:00Z',
      completed: ['task-001', 'task-002']
    }

    const row3Tasks = {
      prd: {
        name: 'Bootstrap Schema Flyway Testcontainers Parity',
        source: 'docs/prd/bootstrap-schema-flyway-testcontainers-parity.md',
        createdAt: now
      },
      tasks: []
    }

    const row3Progress = {
      prdName: 'Bootstrap Schema Flyway Testcontainers Parity',
      totalTasks: 0,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: now,
      patterns: [],
      taskLogs: []
    }

    await dbRun(
      `
        INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [repo.id, 'admin-portal-push-notifications-mvp', JSON.stringify(row1Tasks), JSON.stringify(row1Progress), null, now]
    )

    await dbRun(
      `
        INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [repo.id, 'mobile-logs-relay-secrets-remediation', JSON.stringify(row2Tasks), JSON.stringify(row2Progress), null, now]
    )

    await dbRun(
      `
        INSERT INTO prd_states (repo_id, slug, tasks_json, progress_json, notes_md, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [repo.id, 'bootstrap-schema-flyway-testcontainers-parity', JSON.stringify(row3Tasks), JSON.stringify(row3Progress), null, now]
    )

    await startStateMigration()

    const status = getStateMigrationStatus()
    assert.equal(status.state, 'completed')
    assert.equal(status.totalRows, 3)
    assert.equal(status.migratedRows, 2)
    assert.equal(status.failedRows, 0)

    const migratedRow1 = await dbGet(
      'SELECT progress_json FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, 'admin-portal-push-notifications-mvp']
    )

    const migratedRow2 = await dbGet(
      'SELECT progress_json FROM prd_states WHERE repo_id = ? AND slug = ?',
      [repo.id, 'mobile-logs-relay-secrets-remediation']
    )

    const canonical1 = JSON.parse(migratedRow1.progress_json)
    const canonical2 = JSON.parse(migratedRow2.progress_json)

    assert.deepEqual(canonical1.patterns, [])
    assert.deepEqual(canonical1.taskLogs, [])
    assert.equal(Object.prototype.hasOwnProperty.call(canonical1, 'taskProgress'), false)

    assert.equal(canonical2.totalTasks, 14)
    assert.equal(canonical2.completed, 2)
    assert.equal(canonical2.inProgress, 0)
    assert.equal(canonical2.blocked, 0)
    assert.equal(canonical2.startedAt, '2026-02-23T18:05:29Z')
    assert.deepEqual(canonical2.patterns, [{
      name: 'Prefer helper reuse',
      description: 'Prefer helper reuse'
    }])
    assert.equal(Object.prototype.hasOwnProperty.call(canonical2, 'started'), false)

    const marker = await dbGet('SELECT value FROM app_meta WHERE key = ?', ['state-migration:progress-json-v2'])
    assert.ok(marker)

    await startStateMigration()
    const rerunStatus = getStateMigrationStatus()
    assert.equal(rerunStatus.state, 'completed')
    assert.equal(rerunStatus.migratedRows, 2)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
