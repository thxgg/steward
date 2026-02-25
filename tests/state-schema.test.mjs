import assert from 'node:assert/strict'
import test from 'node:test'

import {
  needsProgressMigration,
  parseProgressFile,
  parseStoredProgressFile,
  parseTasksFile
} from '../dist/server/utils/state-schema.js'

test('tasks schema fills legacy defaults for passes and dependencies', () => {
  const parsed = parseTasksFile({
    prd: {
      name: 'Example',
      source: 'docs/prd/example.md',
      createdAt: new Date().toISOString()
    },
    tasks: [
      {
        id: 'task-1',
        category: 'feature',
        title: 'Do thing',
        description: 'Implement thing',
        steps: ['one'],
        priority: 'high',
        status: 'pending'
      }
    ]
  })

  assert.deepEqual(parsed.tasks[0]?.passes, [])
  assert.deepEqual(parsed.tasks[0]?.dependencies, [])
})

test('progress schema validates status values', () => {
  assert.throws(() => {
    parseProgressFile({
      prdName: 'Example',
      totalTasks: 1,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: new Date().toISOString(),
      patterns: [],
      taskLogs: [
        {
          taskId: 'task-1',
          status: 'blocked',
          startedAt: new Date().toISOString()
        }
      ]
    })
  }, /Invalid enum value/)
})

test('progress schema normalizes legacy pattern entries', () => {
  const parsed = parseProgressFile({
    prdName: 'Example',
    totalTasks: 1,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    startedAt: null,
    lastUpdated: new Date().toISOString(),
    patterns: [
      'Prefer helper reuse',
      {
        name: 'Use schema transforms'
      },
      {
        name: 'Validate repo context',
        description: 'Ensure commits include repo metadata'
      }
    ],
    taskLogs: []
  })

  assert.deepEqual(parsed.patterns, [
    {
      name: 'Prefer helper reuse',
      description: 'Prefer helper reuse'
    },
    {
      name: 'Use schema transforms',
      description: 'Use schema transforms'
    },
    {
      name: 'Validate repo context',
      description: 'Ensure commits include repo metadata'
    }
  ])
})

test('stored progress schema normalizes legacy taskProgress shape', () => {
  const parsed = parseStoredProgressFile({
    prdName: 'Admin Portal Push Notifications MVP',
    totalTasks: 11,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    startedAt: null,
    lastUpdated: '2026-02-19T12:00:00Z',
    taskProgress: {}
  })

  assert.deepEqual(parsed.patterns, [])
  assert.deepEqual(parsed.taskLogs, [])
  assert.equal(parsed.totalTasks, 11)
})

test('stored progress schema normalizes deeply legacy fields', () => {
  const parsed = parseStoredProgressFile({
    prdName: 'Mobile Logs Relay Migration and Secrets Remediation (Codebase Only)',
    started: '2026-02-23T18:05:29Z',
    patterns: ['Prefer configuration holders'],
    taskLogs: [],
    inProgress: null,
    lastUpdated: '2026-02-23T18:20:00Z',
    completed: ['task-001', 'task-002']
  }, {
    totalTasksHint: 14
  })

  assert.equal(parsed.totalTasks, 14)
  assert.equal(parsed.completed, 2)
  assert.equal(parsed.inProgress, 0)
  assert.equal(parsed.blocked, 0)
  assert.equal(parsed.startedAt, '2026-02-23T18:05:29Z')
  assert.deepEqual(parsed.patterns, [{
    name: 'Prefer configuration holders',
    description: 'Prefer configuration holders'
  }])
})

test('legacy progress shapes require migration marker', () => {
  assert.equal(needsProgressMigration({
    prdName: 'Legacy',
    totalTasks: 1,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    startedAt: null,
    lastUpdated: new Date().toISOString(),
    taskProgress: {}
  }), true)

  assert.equal(needsProgressMigration({
    prdName: 'Canonical',
    totalTasks: 1,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    startedAt: null,
    lastUpdated: new Date().toISOString(),
    patterns: [],
    taskLogs: []
  }), false)
})
