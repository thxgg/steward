import assert from 'node:assert/strict'
import test from 'node:test'

test('launcher control server serves state and actions with token auth', async () => {
  const { startLauncherControlServer } = await import('../dist/host/src/launcher/control-server.js')

  let state = {
    mode: 'launcher',
    launcher: {
      context: null,
      engine: {
        state: 'stopped',
        endpoint: null,
        reused: false,
        owned: false,
        pid: null,
        checkedAt: new Date().toISOString(),
        message: 'initial',
        diagnostics: []
      },
      session: {
        state: 'ready',
        activeSessionId: 'sess-1',
        source: 'persisted',
        workspaceKey: 'repo::endpoint',
        endpoint: 'http://127.0.0.1:4096',
        lastResolvedAt: new Date().toISOString(),
        message: 'session bridge ready',
        diagnostics: []
      },
      terminal: {
        renderer: 'libghostty',
        state: 'detached',
        sessionId: 'sess-1',
        rows: 24,
        cols: 80,
        scrollbackLimit: 1000,
        attachedAt: null,
        detachedAt: new Date().toISOString(),
        message: 'terminal ready',
        diagnostics: []
      },
      capabilities: [],
      warnings: [],
      contract: { host: [], ui: [] }
    }
  }

  const sentSessionMessages = []
  const terminalInputs = []
  const terminalResizes = []

  const server = await startLauncherControlServer({
    getState: () => state,
    runAction: async (action) => {
      state = {
        ...state,
        launcher: {
          ...state.launcher,
          engine: {
            ...state.launcher.engine,
            state: action === 'restart' ? 'starting' : 'healthy',
            message: `ran ${action}`,
            checkedAt: new Date().toISOString()
          }
        }
      }

      return state
    },
    getSessionState: () => state.launcher.session,
    sendSessionMessage: async (input) => {
      sentSessionMessages.push(input)
      return {
        sessionId: state.launcher.session.activeSessionId,
        accepted: true,
        requestId: `${input.role}-request`
      }
    },
    fetchSessionEvents: async () => {
      return {
        sessionId: state.launcher.session.activeSessionId,
        events: [
          {
            id: 'evt-1',
            type: 'message',
            payload: { ok: true }
          }
        ],
        cursor: 'cursor-1'
      }
    },
    getTerminalState: () => state.launcher.terminal,
    attachTerminal: async (options) => {
      state = {
        ...state,
        launcher: {
          ...state.launcher,
          terminal: {
            ...state.launcher.terminal,
            state: 'attached',
            rows: options?.rows || state.launcher.terminal.rows,
            cols: options?.cols || state.launcher.terminal.cols,
            attachedAt: new Date().toISOString(),
            detachedAt: null,
            message: 'terminal attached'
          }
        }
      }

      return {
        terminal: state.launcher.terminal
      }
    },
    detachTerminal: async (reason) => {
      state = {
        ...state,
        launcher: {
          ...state.launcher,
          terminal: {
            ...state.launcher.terminal,
            state: 'detached',
            detachedAt: new Date().toISOString(),
            message: reason ? `detached: ${reason}` : 'detached'
          }
        }
      }

      return {
        terminal: state.launcher.terminal
      }
    },
    sendTerminalInput: async (input) => {
      terminalInputs.push(input)
      return {
        terminal: state.launcher.terminal,
        accepted: true,
        requestId: 'terminal-request-1'
      }
    },
    resizeTerminal: async (rows, cols) => {
      terminalResizes.push({ rows, cols })

      state = {
        ...state,
        launcher: {
          ...state.launcher,
          terminal: {
            ...state.launcher.terminal,
            rows,
            cols,
            message: `resized ${rows}x${cols}`
          }
        }
      }

      return {
        terminal: state.launcher.terminal
      }
    },
    fetchTerminalOutput: async () => {
      return {
        terminal: state.launcher.terminal,
        events: [
          {
            id: 'te_1',
            channel: 'stdout',
            text: 'terminal output',
            timestamp: new Date().toISOString()
          }
        ],
        cursor: 'te_1'
      }
    }
  })

  try {
    const unauthorized = await fetch(`${server.url}/state`)
    assert.equal(unauthorized.status, 401)

    const stateResponse = await fetch(`${server.url}/state`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(stateResponse.status, 200)
    const stateBody = await stateResponse.json()
    assert.equal(stateBody.ok, true)
    assert.equal(stateBody.result.launcher.engine.state, 'stopped')

    const invalidActionResponse = await fetch(`${server.url}/action`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'invalid' })
    })
    assert.equal(invalidActionResponse.status, 400)

    const actionResponse = await fetch(`${server.url}/action`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'retry' })
    })
    assert.equal(actionResponse.status, 200)
    const actionBody = await actionResponse.json()
    assert.equal(actionBody.ok, true)
    assert.equal(actionBody.result.launcher.engine.state, 'healthy')
    assert.match(actionBody.result.launcher.engine.message, /retry/)

    const sessionStateResponse = await fetch(`${server.url}/session`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(sessionStateResponse.status, 200)
    const sessionStateBody = await sessionStateResponse.json()
    assert.equal(sessionStateBody.ok, true)
    assert.equal(sessionStateBody.result.activeSessionId, 'sess-1')

    const sessionMessageResponse = await fetch(`${server.url}/session/message`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ role: 'user', content: 'hello' })
    })
    assert.equal(sessionMessageResponse.status, 200)
    const sessionMessageBody = await sessionMessageResponse.json()
    assert.equal(sessionMessageBody.ok, true)
    assert.equal(sessionMessageBody.result.sessionId, 'sess-1')
    assert.deepEqual(sentSessionMessages, [
      {
        role: 'user',
        content: 'hello'
      }
    ])

    const sessionEventsResponse = await fetch(`${server.url}/session/events`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(sessionEventsResponse.status, 200)
    const sessionEventsBody = await sessionEventsResponse.json()
    assert.equal(sessionEventsBody.ok, true)
    assert.equal(sessionEventsBody.result.events.length, 1)

    const terminalStateResponse = await fetch(`${server.url}/terminal/state`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(terminalStateResponse.status, 200)
    const terminalStateBody = await terminalStateResponse.json()
    assert.equal(terminalStateBody.ok, true)
    assert.equal(terminalStateBody.result.renderer, 'libghostty')

    const terminalAttachResponse = await fetch(`${server.url}/terminal/attach`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ rows: 30, cols: 120 })
    })
    assert.equal(terminalAttachResponse.status, 200)
    const terminalAttachBody = await terminalAttachResponse.json()
    assert.equal(terminalAttachBody.ok, true)
    assert.equal(terminalAttachBody.result.terminal.state, 'attached')
    assert.equal(terminalAttachBody.result.terminal.rows, 30)
    assert.equal(terminalAttachBody.result.terminal.cols, 120)

    const terminalInputResponse = await fetch(`${server.url}/terminal/input`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ input: 'ls' })
    })
    assert.equal(terminalInputResponse.status, 200)
    const terminalInputBody = await terminalInputResponse.json()
    assert.equal(terminalInputBody.ok, true)
    assert.equal(terminalInputBody.result.accepted, true)
    assert.deepEqual(terminalInputs, ['ls'])

    const terminalResizeResponse = await fetch(`${server.url}/terminal/resize`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ rows: 40, cols: 140 })
    })
    assert.equal(terminalResizeResponse.status, 200)
    const terminalResizeBody = await terminalResizeResponse.json()
    assert.equal(terminalResizeBody.ok, true)
    assert.equal(terminalResizeBody.result.terminal.rows, 40)
    assert.equal(terminalResizeBody.result.terminal.cols, 140)
    assert.deepEqual(terminalResizes, [{ rows: 40, cols: 140 }])

    const terminalOutputResponse = await fetch(`${server.url}/terminal/output`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(terminalOutputResponse.status, 200)
    const terminalOutputBody = await terminalOutputResponse.json()
    assert.equal(terminalOutputBody.ok, true)
    assert.equal(terminalOutputBody.result.events.length, 1)

    const terminalDetachResponse = await fetch(`${server.url}/terminal/detach`, {
      method: 'POST',
      headers: {
        'x-steward-launcher-token': server.token,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ reason: 'manual' })
    })
    assert.equal(terminalDetachResponse.status, 200)
    const terminalDetachBody = await terminalDetachResponse.json()
    assert.equal(terminalDetachBody.ok, true)
    assert.equal(terminalDetachBody.result.terminal.state, 'detached')
  } finally {
    await server.close()
  }
})
