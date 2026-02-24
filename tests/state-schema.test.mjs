import assert from 'node:assert/strict'
import test from 'node:test'

import { parseProgressFile, parseTasksFile } from '../dist/server/utils/state-schema.js'

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
