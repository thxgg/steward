import assert from 'node:assert/strict'
import test from 'node:test'

function createReadySessionStatus(sessionId = 'sess-1') {
  return {
    state: 'ready',
    activeSessionId: sessionId,
    source: 'persisted',
    workspaceKey: 'repo::endpoint',
    endpoint: 'http://127.0.0.1:4096',
    lastResolvedAt: new Date().toISOString(),
    message: 'session ready',
    diagnostics: []
  }
}

test('terminal bridge supports attach, input, output, resize, and detach baseline', async () => {
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sentMessages = []
  let eventCallCount = 0

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => createReadySessionStatus('sess-main'),
    sendSessionMessage: async (input) => {
      sentMessages.push(input)
      return {
        sessionId: 'sess-main',
        accepted: true,
        requestId: 'request-1'
      }
    },
    fetchSessionEvents: async () => {
      eventCallCount += 1

      if (eventCallCount > 1) {
        return {
          sessionId: 'sess-main',
          events: [],
          cursor: 'cursor-2'
        }
      }

      return {
        sessionId: 'sess-main',
        events: [
          {
            id: 'evt-1',
            type: 'message',
            payload: { content: 'ready' }
          }
        ],
        cursor: 'cursor-1'
      }
    }
  })

  const attached = await bridge.attach({ rows: 30, cols: 120 })
  assert.equal(attached.terminal.state, 'attached')
  assert.equal(attached.terminal.rows, 30)
  assert.equal(attached.terminal.cols, 120)

  const inputResult = await bridge.sendInput('echo hello')
  assert.equal(inputResult.accepted, true)
  assert.equal(inputResult.requestId, 'request-1')
  assert.deepEqual(sentMessages, [
    {
      role: 'user',
      content: 'echo hello'
    }
  ])

  const output = await bridge.fetchOutput()
  assert.equal(output.terminal.state, 'attached')
  assert.ok(output.events.length >= 2)

  const resized = await bridge.resize(40, 140)
  assert.equal(resized.terminal.rows, 40)
  assert.equal(resized.terminal.cols, 140)

  const detached = await bridge.detach('test detach')
  assert.equal(detached.terminal.state, 'detached')
  assert.ok(detached.terminal.message.includes('detached'))
})

test('terminal bridge requires explicit reattach after active session changes', async () => {
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sessionStatus = createReadySessionStatus('sess-1')

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => sessionStatus,
    sendSessionMessage: async () => {
      return {
        sessionId: sessionStatus.activeSessionId,
        accepted: true,
        requestId: null
      }
    },
    fetchSessionEvents: async () => {
      return {
        sessionId: sessionStatus.activeSessionId,
        events: [],
        cursor: null
      }
    }
  })

  await bridge.attach()
  assert.equal(bridge.getStatus().sessionId, 'sess-1')

  sessionStatus.activeSessionId = 'sess-2'
  sessionStatus.lastResolvedAt = new Date().toISOString()

  const output = await bridge.fetchOutput()
  assert.equal(output.terminal.sessionId, 'sess-1')
  assert.equal(output.terminal.activeSessionId, 'sess-2')
  assert.equal(output.terminal.state, 'degraded')
  assert.equal(output.terminal.requiresReattach, true)
  assert.ok(output.events.some((event) => event.text.includes('Session switched')))

  await assert.rejects(async () => {
    await bridge.sendInput('pwd')
  }, /Confirm terminal reattach/)

  const reattached = await bridge.attach()
  assert.equal(reattached.terminal.sessionId, 'sess-2')
  assert.equal(reattached.terminal.state, 'attached')
  assert.equal(reattached.terminal.requiresReattach, false)
})

test('terminal bridge automatically reattaches after temporary session unavailability', async () => {
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sessionStatus = createReadySessionStatus('sess-1')

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => sessionStatus,
    sendSessionMessage: async () => {
      return {
        sessionId: sessionStatus.activeSessionId,
        accepted: true,
        requestId: null
      }
    },
    fetchSessionEvents: async () => {
      return {
        sessionId: sessionStatus.activeSessionId,
        events: [],
        cursor: null
      }
    }
  })

  await bridge.attach()
  assert.equal(bridge.getStatus().state, 'attached')

  sessionStatus.state = 'degraded'
  sessionStatus.activeSessionId = null
  sessionStatus.message = 'session bridge unavailable'

  const unavailable = await bridge.fetchOutput()
  assert.equal(unavailable.terminal.state, 'degraded')

  sessionStatus.state = 'ready'
  sessionStatus.activeSessionId = 'sess-1'
  sessionStatus.message = 'session ready'

  const recovered = await bridge.fetchOutput(unavailable.cursor)
  assert.equal(recovered.terminal.state, 'attached')
  assert.equal(recovered.terminal.sessionId, 'sess-1')
  assert.equal(recovered.terminal.requiresReattach, false)
  assert.ok(recovered.events.some((event) => event.text.includes('Reattached terminal')))
})

test('terminal bridge blocks repeated input after bridge session mismatch until reattach', async () => {
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sessionStatus = createReadySessionStatus('sess-1')
  let sendCallCount = 0

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => sessionStatus,
    sendSessionMessage: async () => {
      sendCallCount += 1
      return {
        sessionId: 'sess-2',
        accepted: true,
        requestId: 'request-mismatch'
      }
    },
    fetchSessionEvents: async () => {
      return {
        sessionId: sessionStatus.activeSessionId,
        events: [],
        cursor: null
      }
    }
  })

  await bridge.attach()

  await assert.rejects(async () => {
    await bridge.sendInput('echo one')
  }, /Session mismatch detected/)
  assert.equal(sendCallCount, 1)

  await assert.rejects(async () => {
    await bridge.sendInput('echo two')
  }, /Confirm terminal reattach/)
  assert.equal(sendCallCount, 1)

  const status = bridge.getStatus()
  assert.equal(status.state, 'degraded')
  assert.equal(status.requiresReattach, true)
})
