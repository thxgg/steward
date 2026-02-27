import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectSyncBundle, inspectSyncBundleJson } from '../dist/server/utils/sync-inspect.js'

function createBundleFixture() {
  return {
    type: 'steward-sync-bundle',
    formatVersion: 1,
    bundleId: 'bundle-inspect-001',
    createdAt: '2026-02-27T00:00:00.000Z',
    sourceDeviceId: 'device-001',
    stewardVersion: '0.1.24',
    repos: [
      {
        repoSyncKey: 'rsk_b',
        name: 'Repo B',
        pathHint: 'repo-b',
        fingerprint: 'fingerprint-b',
        fingerprintKind: 'git-remotes-v1'
      },
      {
        repoSyncKey: 'rsk_a',
        name: 'Repo A',
        pathHint: 'repo-a',
        fingerprint: 'fingerprint-a',
        fingerprintKind: 'git-remotes-v1'
      }
    ],
    states: [
      {
        repoSyncKey: 'rsk_b',
        slug: 'beta-prd',
        tasks: null,
        progress: null,
        notes: null,
        clocks: {
          tasksUpdatedAt: null,
          progressUpdatedAt: null,
          notesUpdatedAt: null
        },
        hashes: {
          tasksHash: null,
          progressHash: null,
          notesHash: null
        }
      },
      {
        repoSyncKey: 'rsk_a',
        slug: 'alpha-prd',
        tasks: null,
        progress: null,
        notes: null,
        clocks: {
          tasksUpdatedAt: null,
          progressUpdatedAt: null,
          notesUpdatedAt: null
        },
        hashes: {
          tasksHash: null,
          progressHash: null,
          notesHash: null
        }
      },
      {
        repoSyncKey: 'rsk_unknown',
        slug: 'orphan-prd',
        tasks: null,
        progress: null,
        notes: null,
        clocks: {
          tasksUpdatedAt: null,
          progressUpdatedAt: null,
          notesUpdatedAt: null
        },
        hashes: {
          tasksHash: null,
          progressHash: null,
          notesHash: null
        }
      }
    ],
    archives: [
      {
        repoSyncKey: 'rsk_b',
        slug: 'beta-prd',
        archivedAt: '2026-02-27T01:00:00.000Z'
      },
      {
        repoSyncKey: 'rsk_unknown',
        slug: 'orphan-prd',
        archivedAt: '2026-02-27T02:00:00.000Z'
      }
    ]
  }
}

test('inspectSyncBundle summarizes metadata, repo coverage, and row totals', () => {
  const summary = inspectSyncBundle(createBundleFixture())

  assert.equal(summary.bundleId, 'bundle-inspect-001')
  assert.equal(summary.sourceDeviceId, 'device-001')
  assert.equal(summary.formatVersion, 1)

  assert.deepEqual(summary.totals, {
    repos: 2,
    states: 3,
    archives: 2,
    unknownRepoStates: 1,
    unknownRepoArchives: 1
  })

  assert.equal(summary.repos.length, 2)
  assert.deepEqual(summary.repos.map((repo) => repo.repoSyncKey), ['rsk_a', 'rsk_b'])
  assert.deepEqual(summary.repos[0]?.stateSlugs, ['alpha-prd'])
  assert.deepEqual(summary.repos[1]?.stateSlugs, ['beta-prd'])
  assert.deepEqual(summary.repos[1]?.archiveSlugs, ['beta-prd'])

  assert.deepEqual(summary.unknownRepoStates, [
    {
      repoSyncKey: 'rsk_unknown',
      slugs: ['orphan-prd']
    }
  ])

  assert.deepEqual(summary.unknownRepoArchives, [
    {
      repoSyncKey: 'rsk_unknown',
      slugs: ['orphan-prd']
    }
  ])
})

test('inspectSyncBundle is deterministic for reordered bundle rows', () => {
  const fixture = createBundleFixture()
  const reversed = {
    ...fixture,
    repos: [...fixture.repos].reverse(),
    states: [...fixture.states].reverse(),
    archives: [...fixture.archives].reverse()
  }

  const first = inspectSyncBundle(fixture)
  const second = inspectSyncBundle(reversed)

  assert.deepEqual(second, first)
})

test('inspectSyncBundleJson rejects invalid json payload', () => {
  assert.throws(
    () => inspectSyncBundleJson('{"type":"steward-sync-bundle"'),
    /Invalid bundle JSON/
  )
})
