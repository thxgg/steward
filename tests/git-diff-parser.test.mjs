import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDiffHunksForTest } from '../dist/server/utils/git.js'

test('diff parser does not add phantom context lines', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 83db48f..f735c13 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-old line',
    '+new line',
    ''
  ].join('\n')

  const hunks = parseDiffHunksForTest(diff)
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0]?.lines.length, 2)
  assert.deepEqual(
    hunks[0]?.lines.map((line) => line.type),
    ['remove', 'add']
  )
})

test('diff parser preserves removed lines that begin with dashes', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 83db48f..f735c13 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '----keep-this',
    '+new line',
    ''
  ].join('\n')

  const hunks = parseDiffHunksForTest(diff)
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0]?.lines.length, 2)
  assert.equal(hunks[0]?.lines[0]?.type, 'remove')
  assert.equal(hunks[0]?.lines[0]?.content, '---keep-this')
})

test('diff parser preserves added lines that begin with pluses', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 83db48f..f735c13 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-old line',
    '++++keep-this',
    ''
  ].join('\n')

  const hunks = parseDiffHunksForTest(diff)
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0]?.lines.length, 2)
  assert.equal(hunks[0]?.lines[1]?.type, 'add')
  assert.equal(hunks[0]?.lines[1]?.content, '+++keep-this')
})
