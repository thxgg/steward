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

test('terminal bridge rebinds session after active session changes', async () => {
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
  assert.equal(output.terminal.sessionId, 'sess-2')
  assert.equal(output.terminal.state, 'attached')
  assert.ok(output.events.some((event) => event.text.includes('Session changed')))
})
