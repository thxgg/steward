import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }

      const text = Buffer.concat(chunks).toString('utf-8').trim()
      if (!text) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}

async function withSessionBridgeServer() {
  const state = {
    sessions: [],
    created: 0,
    messages: [],
    messagePaths: [],
    messageReadPaths: []
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')

    if (request.method === 'GET' && requestUrl.pathname === '/session') {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(state.sessions.map((id) => ({ id }))))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/session') {
      state.created += 1
      const id = `sess-created-${state.created}`
      state.sessions.push(id)

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id }))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname.startsWith('/session/') && requestUrl.pathname.endsWith('/message')) {
      state.messagePaths.push(requestUrl.pathname)
      const body = await parseJsonBody(request)
      assert.ok(Array.isArray(body.parts))
      assert.ok(typeof body.parts[0]?.text === 'string')
      state.messages.push(body)
      const sessionId = requestUrl.pathname.split('/')[2]
      const messageId = `msg-send-${state.messages.length}`

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        info: {
          id: messageId,
          sessionID: sessionId,
          role: 'assistant'
        },
        parts: [
          {
            id: `part-send-${state.messages.length}`,
            type: 'text',
            text: `ack:${body.parts[0].text}`
          }
        ]
      }))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/session/') && requestUrl.pathname.endsWith('/message')) {
      state.messageReadPaths.push(requestUrl.pathname)
      const sessionId = requestUrl.pathname.split('/')[2]

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify([
        {
          info: {
            id: 'msg-evt-1',
            sessionID: sessionId,
            role: 'assistant',
            time: {
              created: 1
            }
          },
          parts: [
            {
              id: 'part-evt-1',
              type: 'text',
              text: 'ready'
            }
          ]
        },
        {
          info: {
            id: 'msg-evt-2',
            sessionID: sessionId,
            role: 'assistant',
            time: {
              created: 2
            }
          },
          parts: [
            {
              id: 'part-evt-2',
              type: 'text',
              text: 'next'
            }
          ]
        }
      ]))
      return
    }

    response.statusCode = 404
    response.end('not-found')
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address')
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    state,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}

test('session bridge persists and restores active session deterministically', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-session-bridge-'))
  const storePath = join(tempRoot, 'launcher-session-store.json')

  const server = await withSessionBridgeServer()

  try {
    const { startSessionBridge } = await import('../dist/host/src/launcher/session-bridge.js')

    const bridgeFirst = await startSessionBridge({
      endpoint: server.endpoint,
      repoId: 'repo-1',
      repoPath: '/workspace/repo-1',
      storePath
    })

    const firstStatus = bridgeFirst.getStatus()
    assert.equal(firstStatus.state, 'ready')
    assert.equal(firstStatus.source, 'created')
    assert.ok(firstStatus.activeSessionId)
    assert.equal(server.state.created, 1)

    const bridgeSecond = await startSessionBridge({
      endpoint: server.endpoint,
      repoId: 'repo-1',
      repoPath: '/workspace/repo-1',
      storePath
    })

    const secondStatus = bridgeSecond.getStatus()
    assert.equal(secondStatus.state, 'ready')
    assert.equal(secondStatus.source, 'persisted')
    assert.equal(secondStatus.activeSessionId, firstStatus.activeSessionId)
    assert.equal(server.state.created, 1)
  } finally {
    await server.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('session bridge routes message and event traffic to active session identity', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-session-bridge-events-'))
  const storePath = join(tempRoot, 'launcher-session-store.json')

  const server = await withSessionBridgeServer()

  try {
    const { startSessionBridge } = await import('../dist/host/src/launcher/session-bridge.js')
    const { buildWorkflowCommand } = await import('../dist/app/lib/launcher-workflow.js')

    const bridge = await startSessionBridge({
      endpoint: server.endpoint,
      repoId: 'repo-2',
      repoPath: '/workspace/repo-2',
      storePath,
      explicitSessionId: 'sess-explicit-9'
    })

    const status = bridge.getStatus()
    assert.equal(status.activeSessionId, 'sess-explicit-9')
    assert.equal(status.source, 'explicit')
    assert.equal(server.state.created, 0)

    const breakCommand = buildWorkflowCommand('break_into_tasks', 'demo-prd')
    const completeCommand = buildWorkflowCommand('complete_next_task', 'demo-prd')

    const messageResult = await bridge.sendMessage({
      role: 'user',
      content: breakCommand
    })
    assert.equal(messageResult.accepted, true)
    assert.equal(messageResult.sessionId, status.activeSessionId)

    const secondMessageResult = await bridge.sendMessage({
      role: 'user',
      content: completeCommand
    })
    assert.equal(secondMessageResult.accepted, true)
    assert.equal(secondMessageResult.sessionId, status.activeSessionId)

    const eventsResult = await bridge.fetchEvents('cursor-0')
    assert.equal(eventsResult.sessionId, status.activeSessionId)
    assert.equal(eventsResult.events.length, 2)
    assert.equal(eventsResult.cursor, 'msg-evt-2')

    assert.equal(server.state.messages.length, 2)
    assert.deepEqual(server.state.messages.map((entry) => entry.parts[0].text), [
      breakCommand,
      completeCommand
    ])
    assert.ok(server.state.messagePaths.every((path) => path.includes(status.activeSessionId)))
    assert.ok(server.state.messageReadPaths.every((path) => path.includes(status.activeSessionId)))
  } finally {
    await server.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('session bridge reports actionable diagnostics when endpoint serves html shell', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-session-bridge-html-shell-'))
  const storePath = join(tempRoot, 'launcher-session-store.json')

  const server = createServer((_request, response) => {
    response.statusCode = 200
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body>OpenCode Web Shell</body></html>')
  })

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve html-shell server address')
  }

  const endpoint = `http://127.0.0.1:${address.port}`

  try {
    const { startSessionBridge } = await import('../dist/host/src/launcher/session-bridge.js')

    const bridge = await startSessionBridge({
      endpoint,
      repoId: 'repo-html',
      repoPath: '/workspace/repo-html',
      storePath
    })

    const status = bridge.getStatus()
    assert.equal(status.state, 'degraded')
    assert.equal(status.activeSessionId, null)
    assert.equal(status.source, 'none')
    assert.ok(status.diagnostics.some((entry) => entry.includes('OpenCode endpoint returned HTML instead of JSON')))
    assert.match(status.message, /could not resolve or create an active session/i)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })

    await rm(tempRoot, { recursive: true, force: true })
  }
})
