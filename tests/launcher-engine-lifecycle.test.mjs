import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

async function withServer(handler) {
  const server = createServer(handler)

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address')
  }

  const endpoint = `http://127.0.0.1:${address.port}`

  return {
    endpoint,
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

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('engine lifecycle reuses healthy configured endpoint without spawning', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-reuse-'))

  const server = await withServer((request, response) => {
    if (request.url === '/health' || request.url === '/openapi.json' || request.url === '/') {
      response.statusCode = 200
      response.end('ok')
      return
    }

    response.statusCode = 404
    response.end('not-found')
  })

  let lifecycle = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      configuredEndpoint: server.endpoint,
      startupTimeoutMs: 2000,
      healthPollIntervalMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'healthy')
    assert.equal(status.reused, true)
    assert.equal(status.owned, false)
    assert.equal(status.endpoint, server.endpoint)
    assert.equal(status.connectionMode, 'shared')
    assert.equal(status.bindingMode, 'localhost')
    assert.equal(status.authMode, 'none')
    assert.equal(status.instanceKey, `engine:${server.endpoint}`)
    assert.equal(status.pid, null)
    assert.equal(lifecycle.getAuthToken(), null)
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await server.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('engine lifecycle falls back to managed process and stops owned child on shutdown', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-spawn-'))

  const healthyServer = await withServer((_request, response) => {
    response.statusCode = 200
    response.end('ok')
  })
  const localEndpoint = healthyServer.endpoint
  await healthyServer.close()

  const unreachableServer = await withServer((_request, response) => {
    response.statusCode = 503
    response.end('unavailable')
  })
  const configuredEndpoint = unreachableServer.endpoint
  await unreachableServer.close()

  const fakeEnginePath = join(tempRoot, 'fake-opencode.mjs')
  await writeFile(
    fakeEnginePath,
    [
      "import { createServer } from 'node:http'",
      '',
      'const args = process.argv.slice(2)',
      "const portIndex = args.indexOf('--port')",
      'const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4096',
      "const host = '127.0.0.1'",
      '',
      'const server = createServer((req, res) => {',
      "  if (req.url === '/health' || req.url === '/openapi.json' || req.url === '/') {",
      '    res.statusCode = 200',
      "    res.end('ok')",
      '    return',
      '  }',
      '  res.statusCode = 404',
      "  res.end('not-found')",
      '})',
      '',
      'const stop = () => {',
      '  server.close(() => process.exit(0))',
      '  setTimeout(() => process.exit(0), 200).unref()',
      '}',
      '',
      "process.on('SIGTERM', stop)",
      "process.on('SIGINT', stop)",
      '',
      'server.listen(port, host)',
      'setInterval(() => {}, 1000)'
    ].join('\n'),
    'utf-8'
  )

  let lifecycle = null
  let startedPid = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      configuredEndpoint,
      localEndpoint,
      command: process.execPath,
      args: [fakeEnginePath, 'serve', '--port', new URL(localEndpoint).port],
      startupTimeoutMs: 4000,
      healthPollIntervalMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'healthy')
    assert.equal(status.reused, false)
    assert.equal(status.owned, true)
    assert.equal(status.endpoint, localEndpoint)
    assert.equal(status.connectionMode, 'shared')
    assert.equal(status.bindingMode, 'localhost')
    assert.equal(status.authMode, 'generated')
    assert.equal(status.instanceKey, `engine:${localEndpoint}`)
    assert.ok(typeof status.pid === 'number' && status.pid > 0)
    assert.ok(typeof lifecycle.getAuthToken() === 'string' && lifecycle.getAuthToken().length > 0)

    startedPid = status.pid
    assert.equal(isProcessAlive(startedPid), true)

    const stopped = await lifecycle.stop('test stop')
    assert.equal(stopped.state, 'stopped')
    assert.equal(stopped.owned, false)
    assert.equal(stopped.pid, null)

    await delay(120)
    assert.equal(isProcessAlive(startedPid), false)
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('engine lifecycle reports degraded when managed process misses startup timeout', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-timeout-'))

  const fakeEnginePath = join(tempRoot, 'fake-opencode-timeout.mjs')
  await writeFile(
    fakeEnginePath,
    [
      "import { createServer } from 'node:http'",
      '',
      'const args = process.argv.slice(2)',
      "const portIndex = args.indexOf('--port')",
      'const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4096',
      "const host = '127.0.0.1'",
      '',
      'const server = createServer((_req, res) => {',
      '  res.statusCode = 503',
      "  res.end('not-ready')",
      '})',
      '',
      'const stop = () => {',
      '  server.close(() => process.exit(0))',
      '  setTimeout(() => process.exit(0), 200).unref()',
      '}',
      '',
      "process.on('SIGTERM', stop)",
      "process.on('SIGINT', stop)",
      '',
      'server.listen(port, host)',
      'setInterval(() => {}, 1000)'
    ].join('\n'),
    'utf-8'
  )

  let lifecycle = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      localEndpoint: 'http://127.0.0.1:4296',
      command: process.execPath,
      args: [fakeEnginePath, 'serve', '--port', '4296'],
      startupTimeoutMs: 500,
      healthPollIntervalMs: 100,
      fetchTimeoutMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'degraded')
    assert.equal(status.owned, false)
    assert.equal(status.endpoint, 'http://127.0.0.1:4296')
    assert.ok(status.diagnostics.some((entry) => entry.includes('did not become healthy')))
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('engine lifecycle reuses healthy local endpoint to avoid duplicate engine spawn', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-local-reuse-'))

  const server = await withServer((_request, response) => {
    response.statusCode = 200
    response.end('ok')
  })

  let lifecycle = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      localEndpoint: server.endpoint,
      command: 'definitely-not-a-real-opencode-command',
      startupTimeoutMs: 1500,
      healthPollIntervalMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'healthy')
    assert.equal(status.reused, true)
    assert.equal(status.owned, false)
    assert.equal(status.endpoint, server.endpoint)
    assert.equal(status.connectionMode, 'shared')
    assert.equal(status.bindingMode, 'localhost')
    assert.equal(status.authMode, 'none')
    assert.equal(status.instanceKey, `engine:${server.endpoint}`)
    assert.equal(status.pid, null)
    assert.equal(lifecycle.getAuthToken(), null)
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await server.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('engine lifecycle blocks network-visible endpoint unless explicitly allowed', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-network-block-'))

  let lifecycle = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      localEndpoint: 'http://192.0.2.10:4096',
      command: 'definitely-not-a-real-opencode-command',
      startupTimeoutMs: 1500,
      healthPollIntervalMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'degraded')
    assert.equal(status.bindingMode, 'network')
    assert.equal(status.authMode, 'none')
    assert.match(status.message, /explicit opt-in/i)
    assert.equal(lifecycle.getAuthToken(), null)
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('engine lifecycle requires auth token for configured network endpoint reuse', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-engine-network-auth-'))

  let lifecycle = null

  try {
    const { startOpenCodeEngineLifecycle } = await import('../dist/host/src/launcher/engine-lifecycle.js')

    lifecycle = await startOpenCodeEngineLifecycle({
      cwd: tempRoot,
      configuredEndpoint: 'http://198.51.100.10:4096',
      allowRemote: true,
      command: 'definitely-not-a-real-opencode-command',
      startupTimeoutMs: 1500,
      healthPollIntervalMs: 100
    })

    const status = lifecycle.getStatus()
    assert.equal(status.state, 'degraded')
    assert.equal(status.authMode, 'none')
    assert.ok(status.diagnostics.some((entry) => entry.includes('requires an auth token')))
  } finally {
    if (lifecycle) {
      await lifecycle.stop('test cleanup')
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
