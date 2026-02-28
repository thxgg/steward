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
      capabilities: [],
      warnings: [],
      contract: { host: [], ui: [] }
    }
  }

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

    const sessionEventsResponse = await fetch(`${server.url}/session/events`, {
      headers: {
        'x-steward-launcher-token': server.token
      }
    })
    assert.equal(sessionEventsResponse.status, 200)
    const sessionEventsBody = await sessionEventsResponse.json()
    assert.equal(sessionEventsBody.ok, true)
    assert.equal(sessionEventsBody.result.events.length, 1)
  } finally {
    await server.close()
  }
})
