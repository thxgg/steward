import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePrdMarkdownPath } from '../dist/server/utils/prd-service.js'

test('resolvePrdMarkdownPath keeps path under docs/prd', () => {
  const resolved = resolvePrdMarkdownPath('/tmp/example-repo', 'my-prd')
  assert.equal(resolved, '/tmp/example-repo/docs/prd/my-prd.md')
})

test('resolvePrdMarkdownPath rejects invalid slugs', () => {
  assert.throws(
    () => resolvePrdMarkdownPath('/tmp/example-repo', '../secrets'),
    /Invalid PRD slug format/
  )
})
