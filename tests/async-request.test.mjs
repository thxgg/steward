import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLatestRequestManager,
  isAbortError
} from '../dist/app/lib/async-request.js'

function createDeferred() {
  let resolve
  let reject

  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    promise,
    resolve,
    reject
  }
}

test('latest request manager aborts stale requests on replacement', () => {
  const manager = createLatestRequestManager()

  const first = manager.begin()
  const second = manager.begin()

  assert.equal(first.signal.aborted, true)
  assert.equal(first.isCurrent(), false)
  assert.equal(second.signal.aborted, false)
  assert.equal(second.isCurrent(), true)

  manager.cancel()
  assert.equal(second.signal.aborted, true)
  assert.equal(second.isCurrent(), false)
})

test('clearing stale ticket does not clear active ticket', () => {
  const manager = createLatestRequestManager()

  const first = manager.begin()
  const second = manager.begin()

  manager.clear(first)
  assert.equal(second.isCurrent(), true)

  manager.clear(second)
  assert.equal(second.isCurrent(), false)
})

test('latest request manager allows only newest async result to apply', async () => {
  const manager = createLatestRequestManager()
  const firstDeferred = createDeferred()
  const secondDeferred = createDeferred()

  let appliedResult = null

  async function runRequest(ticket, deferredResult) {
    try {
      const result = await deferredResult.promise
      if (ticket.isCurrent()) {
        appliedResult = result
      }
    } finally {
      manager.clear(ticket)
    }
  }

  const firstTicket = manager.begin()
  const firstRun = runRequest(firstTicket, firstDeferred)

  const secondTicket = manager.begin()
  const secondRun = runRequest(secondTicket, secondDeferred)

  secondDeferred.resolve('new-file')
  firstDeferred.resolve('old-file')

  await Promise.all([firstRun, secondRun])
  assert.equal(appliedResult, 'new-file')
})

test('isAbortError recognizes abort-like failures', () => {
  assert.equal(isAbortError(new DOMException('The operation was aborted', 'AbortError')), true)
  assert.equal(isAbortError({ cause: { name: 'AbortError' } }), true)
  assert.equal(isAbortError(new Error('request aborted by user')), true)

  assert.equal(isAbortError(new Error('network timeout')), false)
  assert.equal(isAbortError(null), false)
})
