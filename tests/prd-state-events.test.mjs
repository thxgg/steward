import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

test('upsertPrdState emits tasks/progress change events', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { addChangeListener } = await import('../dist/server/utils/change-events.js')
    const { upsertPrdState } = await import('../dist/server/utils/prd-state.js')

    const repoPath = join(tempRoot, 'repo')
    await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })

    const repo = await addRepo(repoPath, 'Repo')
    const received = []
    const unsubscribe = addChangeListener((event) => {
      received.push(event)
    })

    await upsertPrdState(repo.id, 'sample-prd', {
      tasks: {
        prd: {
          name: 'Sample PRD',
          source: 'docs/prd/sample-prd.md',
          createdAt: new Date().toISOString()
        },
        tasks: [
          {
            id: 'task-1',
            category: 'feature',
            title: 'Implement change',
            description: 'Implement change',
            steps: ['step'],
            priority: 'high',
            status: 'pending'
          }
        ]
      },
      progress: {
        prdName: 'Sample PRD',
        totalTasks: 1,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        startedAt: null,
        lastUpdated: new Date().toISOString(),
        patterns: [],
        taskLogs: []
      }
    })

    await wait(450)
    unsubscribe()

    assert.equal(received.length, 2)
    assert.deepEqual(
      received.map((event) => event.category).sort(),
      ['progress', 'tasks']
    )
    assert.ok(received.every((event) => event.path.includes('/sample-prd/')))
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('upsertPrdState preserves concurrent field updates', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { getPrdState, upsertPrdState } = await import('../dist/server/utils/prd-state.js')

    const repoPath = join(tempRoot, 'repo')
    await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })

    const repo = await addRepo(repoPath, 'Repo')

    await Promise.all([
      upsertPrdState(repo.id, 'sample-prd', {
        tasks: {
          prd: {
            name: 'Sample PRD',
            source: 'docs/prd/sample-prd.md',
            createdAt: new Date().toISOString()
          },
          tasks: [
            {
              id: 'task-1',
              category: 'feature',
              title: 'Implement change',
              description: 'Implement change',
              steps: ['step'],
              priority: 'high',
              status: 'pending'
            }
          ]
        }
      }),
      upsertPrdState(repo.id, 'sample-prd', {
        progress: {
          prdName: 'Sample PRD',
          totalTasks: 1,
          completed: 0,
          inProgress: 0,
          blocked: 0,
          startedAt: null,
          lastUpdated: new Date().toISOString(),
          patterns: [],
          taskLogs: []
        }
      })
    ])

    const state = await getPrdState(repo.id, 'sample-prd')
    assert.ok(state)
    assert.ok(state.tasks)
    assert.ok(state.progress)
    assert.equal(state.tasks?.tasks[0]?.id, 'task-1')
    assert.equal(state.progress?.totalTasks, 1)
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
