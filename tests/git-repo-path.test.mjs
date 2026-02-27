import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeCommitRepoRefPath } from '../dist/server/utils/git-repo-path.js'

test('normalizeCommitRepoRefPath maps root aliases to canonical root', () => {
  const repo = {
    id: 'repo-1',
    name: 'code-hospitality-monorepo',
    path: '/tmp/code-hospitality-monorepo',
    addedAt: new Date().toISOString(),
    gitRepos: [
      {
        relativePath: 'code-hospitality-backend',
        absolutePath: '/tmp/code-hospitality-monorepo/code-hospitality-backend',
        name: 'code-hospitality-backend'
      }
    ]
  }

  const aliases = [
    '',
    '.',
    './',
    'code-hospitality-monorepo',
    '/tmp/code-hospitality-monorepo'
  ]

  for (const alias of aliases) {
    assert.equal(normalizeCommitRepoRefPath(repo, alias), '')
  }
})

test('normalizeCommitRepoRefPath preserves nested repo paths', () => {
  const repo = {
    id: 'repo-1',
    name: 'code-hospitality-monorepo',
    path: '/tmp/code-hospitality-monorepo',
    addedAt: new Date().toISOString(),
    gitRepos: [
      {
        relativePath: 'code-hospitality-backend',
        absolutePath: '/tmp/code-hospitality-monorepo/code-hospitality-backend',
        name: 'code-hospitality-backend'
      }
    ]
  }

  assert.equal(
    normalizeCommitRepoRefPath(repo, './code-hospitality-backend'),
    'code-hospitality-backend'
  )
  assert.equal(
    normalizeCommitRepoRefPath(repo, '/tmp/code-hospitality-monorepo/code-hospitality-backend'),
    'code-hospitality-backend'
  )
})

test('normalizeCommitRepoRefPath rejects traversal outside repo root', () => {
  const repo = {
    id: 'repo-1',
    name: 'code-hospitality-monorepo',
    path: '/tmp/code-hospitality-monorepo',
    addedAt: new Date().toISOString(),
    gitRepos: []
  }

  assert.equal(normalizeCommitRepoRefPath(repo, '../outside'), null)
})
