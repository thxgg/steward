import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSyncFieldHashes,
  hashCanonicalValue,
  parseSyncBundle,
  validateSyncBundle
} from '../dist/server/utils/sync-schema.js'

function createValidBundle() {
  return {
    type: 'steward-sync-bundle',
    formatVersion: 1,
    bundleId: 'bundle-001',
    createdAt: '2026-02-27T00:00:00.000Z',
    sourceDeviceId: 'device-001',
    stewardVersion: '0.1.24',
    repos: [
      {
        repoSyncKey: 'rsk_abc',
        name: 'steward',
        pathHint: 'steward',
        fingerprint: 'fingerprint-abc',
        fingerprintKind: 'git-remotes-v1'
      }
    ],
    states: [
      {
        repoSyncKey: 'rsk_abc',
        slug: 'cross-device-state-sync-bundles',
        tasks: {
          prd: {
            name: 'Cross-Device State Sync with Portable Bundles',
            source: 'docs/prd/cross-device-state-sync-bundles.md',
            createdAt: '2026-02-27T00:00:00.000Z'
          },
          tasks: []
        },
        progress: {
          prdName: 'Cross-Device State Sync with Portable Bundles',
          totalTasks: 0,
          completed: 0,
          inProgress: 0,
          blocked: 0,
          startedAt: null,
          lastUpdated: '2026-02-27T00:00:00.000Z',
          patterns: [],
          taskLogs: []
        },
        notes: 'Initial notes',
        clocks: {
          tasksUpdatedAt: '2026-02-27T00:00:00.000Z',
          progressUpdatedAt: '2026-02-27T00:00:00.000Z',
          notesUpdatedAt: '2026-02-27T00:00:00.000Z'
        },
        hashes: {
          tasksHash: 'hash-a',
          progressHash: 'hash-b',
          notesHash: 'hash-c'
        }
      }
    ],
    archives: [
      {
        repoSyncKey: 'rsk_abc',
        slug: 'cross-device-state-sync-bundles',
        archivedAt: '2026-02-27T01:00:00.000Z'
      }
    ]
  }
}

test('parseSyncBundle accepts valid bundle payload', () => {
  const bundle = createValidBundle()
  const parsed = parseSyncBundle(bundle)

  assert.equal(parsed.type, 'steward-sync-bundle')
  assert.equal(parsed.formatVersion, 1)
  assert.equal(parsed.states.length, 1)
})

test('validateSyncBundle returns path-aware error for malformed payload', () => {
  const bundle = createValidBundle()
  delete bundle.repos[0].repoSyncKey

  const result = validateSyncBundle(bundle)
  assert.equal(result.success, false)
  assert.ok(result.error)
  assert.match(result.error, /repos\.0\.repoSyncKey/)
})

test('validateSyncBundle rejects unsupported format versions with field path', () => {
  const bundle = createValidBundle()
  bundle.formatVersion = 2

  const result = validateSyncBundle(bundle)
  assert.equal(result.success, false)
  assert.ok(result.error)
  assert.match(result.error, /formatVersion/)
})

test('hashCanonicalValue is stable across object key ordering differences', () => {
  const first = {
    slug: 'example',
    meta: {
      author: 'Generated',
      status: 'Approved'
    },
    tasks: [
      { id: 'task-001', priority: 'high' },
      { id: 'task-002', priority: 'medium' }
    ]
  }

  const second = {
    tasks: [
      { priority: 'high', id: 'task-001' },
      { priority: 'medium', id: 'task-002' }
    ],
    meta: {
      status: 'Approved',
      author: 'Generated'
    },
    slug: 'example'
  }

  assert.equal(hashCanonicalValue(first), hashCanonicalValue(second))
})

test('createSyncFieldHashes hashes each populated field and preserves nulls', () => {
  const hashes = createSyncFieldHashes({
    tasks: { tasks: [{ id: 'task-001' }] },
    progress: { completed: 1, inProgress: 0 },
    notes: null
  })

  assert.equal(typeof hashes.tasksHash, 'string')
  assert.equal(typeof hashes.progressHash, 'string')
  assert.equal(hashes.notesHash, null)
  assert.equal(hashes.tasksHash === hashes.progressHash, false)
})

test('createSyncFieldHashes is deterministic for reordered nested objects', () => {
  const first = createSyncFieldHashes({
    tasks: {
      prd: {
        name: 'Sync PRD',
        source: 'docs/prd/sync-prd.md',
        createdAt: '2026-02-27T00:00:00.000Z'
      },
      tasks: [{ id: 'task-1', priority: 'high' }]
    },
    progress: {
      prdName: 'Sync PRD',
      totalTasks: 1,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-02-27T00:00:00.000Z',
      patterns: [],
      taskLogs: []
    },
    notes: 'same notes'
  })

  const second = createSyncFieldHashes({
    tasks: {
      tasks: [{ priority: 'high', id: 'task-1' }],
      prd: {
        createdAt: '2026-02-27T00:00:00.000Z',
        source: 'docs/prd/sync-prd.md',
        name: 'Sync PRD'
      }
    },
    progress: {
      taskLogs: [],
      patterns: [],
      lastUpdated: '2026-02-27T00:00:00.000Z',
      startedAt: null,
      blocked: 0,
      inProgress: 0,
      completed: 0,
      totalTasks: 1,
      prdName: 'Sync PRD'
    },
    notes: 'same notes'
  })

  assert.deepEqual(second, first)
})
