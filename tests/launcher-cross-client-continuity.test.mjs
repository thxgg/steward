import assert from 'node:assert/strict'
import test from 'node:test'

function createSessionStatus(sessionId = 'sess-shared') {
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

function createEngineStatus() {
  return {
    state: 'healthy',
    endpoint: 'http://127.0.0.1:4096',
    reused: true,
    owned: false,
    pid: null,
    instanceKey: 'engine:http://127.0.0.1:4096',
    connectionMode: 'shared',
    bindingMode: 'localhost',
    authMode: 'generated',
    checkedAt: new Date().toISOString(),
    message: 'reusing shared endpoint',
    diagnostics: []
  }
}

async function readJson(response) {
  const payload = await response.json()
  return payload
}

test('desktop and web clients observe shared terminal continuity through control server', async () => {
  const { startLauncherControlServer } = await import('../dist/host/src/launcher/control-server.js')
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sessionStatus = createSessionStatus('sess-shared')
  const sentMessages = []
  const sessionEvents = []
  let eventSeq = 0

  const parseSessionCursor = (cursor) => {
    if (!cursor) {
      return 0
    }

    const match = /^cursor-(\d+)$/.exec(cursor)
    if (!match || !match[1]) {
      return 0
    }

    return Number.parseInt(match[1], 10) || 0
  }

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => sessionStatus,
    sendSessionMessage: async (input) => {
      sentMessages.push(input)

      eventSeq += 1
      sessionEvents.push({
        id: `evt-${eventSeq}`,
        type: 'assistant.message',
        payload: {
          text: `ack:${input.content}`
        }
      })

      return {
        sessionId: sessionStatus.activeSessionId,
        accepted: true,
        requestId: `req-${eventSeq}`
      }
    },
    fetchSessionEvents: async (cursor) => {
      const minSeq = parseSessionCursor(cursor)
      const events = sessionEvents.filter((event) => {
        const seq = Number.parseInt(event.id.replace('evt-', ''), 10)
        return Number.isFinite(seq) && seq > minSeq
      })

      return {
        sessionId: sessionStatus.activeSessionId,
        events,
        cursor: `cursor-${eventSeq}`
      }
    }
  })

  const getRuntimeState = () => {
    return {
      mode: 'launcher',
      launcher: {
        context: null,
        engine: createEngineStatus(),
        session: {
          ...sessionStatus
        },
        terminal: bridge.getStatus(),
        capabilities: [],
        warnings: [],
        contract: {
          host: [],
          ui: []
        }
      }
    }
  }

  const server = await startLauncherControlServer({
    getState: () => getRuntimeState(),
    runAction: async () => getRuntimeState(),
    getSessionState: () => ({ ...sessionStatus }),
    getTerminalState: () => bridge.getStatus(),
    attachTerminal: async (options) => await bridge.attach(options),
    detachTerminal: async (reason) => await bridge.detach(reason),
    sendTerminalInput: async (input) => await bridge.sendInput(input),
    resizeTerminal: async (rows, cols) => await bridge.resize(rows, cols),
    fetchTerminalOutput: async (cursor) => await bridge.fetchOutput(cursor)
  })

  const headers = {
    'x-steward-launcher-token': server.token,
    'content-type': 'application/json'
  }

  try {
    const attachResponse = await fetch(`${server.url}/terminal/attach`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows: 30, cols: 120 })
    })
    assert.equal(attachResponse.status, 200)

    const desktopInitialOutputResponse = await fetch(`${server.url}/terminal/output`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(desktopInitialOutputResponse.status, 200)
    const desktopInitialOutputBody = await readJson(desktopInitialOutputResponse)
    assert.equal(desktopInitialOutputBody.ok, true)
    const desktopCursor = desktopInitialOutputBody.result.cursor

    const webInputResponse = await fetch(`${server.url}/terminal/input`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: 'echo shared-state' })
    })
    assert.equal(webInputResponse.status, 200)

    const desktopFollowUpOutputResponse = await fetch(`${server.url}/terminal/output?cursor=${encodeURIComponent(desktopCursor)}`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(desktopFollowUpOutputResponse.status, 200)
    const desktopFollowUpOutputBody = await readJson(desktopFollowUpOutputResponse)
    assert.equal(desktopFollowUpOutputBody.ok, true)
    assert.ok(desktopFollowUpOutputBody.result.events.some((event) => event.text.includes('$ echo shared-state')))
    assert.ok(desktopFollowUpOutputBody.result.events.some((event) => event.text.includes('[assistant.message]')))

    sessionStatus.state = 'degraded'
    sessionStatus.activeSessionId = null
    sessionStatus.message = 'session bridge unavailable'

    const webDegradedOutputResponse = await fetch(`${server.url}/terminal/output?cursor=${encodeURIComponent(desktopFollowUpOutputBody.result.cursor)}`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(webDegradedOutputResponse.status, 200)
    const webDegradedOutputBody = await readJson(webDegradedOutputResponse)
    assert.equal(webDegradedOutputBody.result.terminal.state, 'degraded')

    sessionStatus.state = 'ready'
    sessionStatus.activeSessionId = 'sess-shared'
    sessionStatus.message = 'session ready'

    const desktopRecoveredOutputResponse = await fetch(`${server.url}/terminal/output?cursor=${encodeURIComponent(webDegradedOutputBody.result.cursor)}`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(desktopRecoveredOutputResponse.status, 200)
    const desktopRecoveredOutputBody = await readJson(desktopRecoveredOutputResponse)
    assert.equal(desktopRecoveredOutputBody.result.terminal.state, 'attached')
    assert.equal(desktopRecoveredOutputBody.result.terminal.sessionId, 'sess-shared')
    assert.equal(desktopRecoveredOutputBody.result.terminal.activeSessionId, 'sess-shared')
    assert.ok(desktopRecoveredOutputBody.result.events.some((event) => event.text.includes('Reattached terminal')))

    const stateResponse = await fetch(`${server.url}/state`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(stateResponse.status, 200)
    const stateBody = await readJson(stateResponse)
    assert.equal(stateBody.ok, true)
    assert.equal(stateBody.result.launcher.session.activeSessionId, 'sess-shared')
    assert.equal(stateBody.result.launcher.terminal.sessionId, 'sess-shared')
    assert.equal(sentMessages.length, 1)
  } finally {
    await server.close()
  }
})

test('terminal mismatch errors expose reproducible diagnostics for cross-client debugging', async () => {
  const { startLauncherControlServer } = await import('../dist/host/src/launcher/control-server.js')
  const { createLauncherTerminalBridge } = await import('../dist/host/src/launcher/terminal-bridge.js')

  const sessionStatus = createSessionStatus('sess-primary')

  const bridge = createLauncherTerminalBridge({
    getSessionStatus: () => sessionStatus,
    sendSessionMessage: async () => {
      return {
        sessionId: 'sess-other',
        accepted: true,
        requestId: 'req-mismatch'
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

  const getRuntimeState = () => {
    return {
      mode: 'launcher',
      launcher: {
        context: null,
        engine: createEngineStatus(),
        session: {
          ...sessionStatus
        },
        terminal: bridge.getStatus(),
        capabilities: [],
        warnings: [],
        contract: {
          host: [],
          ui: []
        }
      }
    }
  }

  const server = await startLauncherControlServer({
    getState: () => getRuntimeState(),
    runAction: async () => getRuntimeState(),
    getSessionState: () => ({ ...sessionStatus }),
    getTerminalState: () => bridge.getStatus(),
    attachTerminal: async (options) => await bridge.attach(options),
    sendTerminalInput: async (input) => await bridge.sendInput(input),
    fetchTerminalOutput: async (cursor) => await bridge.fetchOutput(cursor)
  })

  const headers = {
    'x-steward-launcher-token': server.token,
    'content-type': 'application/json'
  }

  try {
    const attachResponse = await fetch(`${server.url}/terminal/attach`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows: 24, cols: 80 })
    })
    assert.equal(attachResponse.status, 200)

    const mismatchResponse = await fetch(`${server.url}/terminal/input`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: 'echo mismatch' })
    })
    assert.equal(mismatchResponse.status, 500)
    const mismatchBody = await readJson(mismatchResponse)
    assert.equal(mismatchBody.ok, false)
    assert.equal(mismatchBody.error.code, 'LAUNCHER_TERMINAL_INPUT_FAILED')
    assert.match(mismatchBody.error.message, /Session mismatch detected/)

    const terminalStateResponse = await fetch(`${server.url}/terminal/state`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(terminalStateResponse.status, 200)
    const terminalStateBody = await readJson(terminalStateResponse)
    assert.equal(terminalStateBody.ok, true)
    assert.equal(terminalStateBody.result.requiresReattach, true)
    assert.equal(terminalStateBody.result.state, 'degraded')
    assert.ok(terminalStateBody.result.diagnostics.some((entry) => entry.includes('Session mismatch detected')))
  } finally {
    await server.close()
  }
})
