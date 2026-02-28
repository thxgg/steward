import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function createTask(id, status) {
  return {
    id,
    category: 'setup',
    title: `Task ${id}`,
    description: `Description for ${id}`,
    steps: ['step'],
    passes: ['pass'],
    dependencies: [],
    priority: 'high',
    status
  }
}

function buildState(slug, name, tasks) {
  const completed = tasks.filter((task) => task.status === 'completed').length
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length

  return {
    tasks: {
      prd: {
        name,
        source: `docs/prd/${slug}.md`,
        createdAt: '2026-02-28T00:00:00.000Z'
      },
      tasks
    },
    progress: {
      prdName: name,
      totalTasks: tasks.length,
      completed,
      inProgress,
      blocked: 0,
      startedAt: null,
      lastUpdated: '2026-02-28T00:00:00.000Z',
      patterns: [],
      taskLogs: []
    }
  }
}

test('launcher bootstrap resolves actionable PRD context and exposes capability handshake', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-launcher-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const repoPath = join(tempRoot, 'repo-launcher')
    const prdDir = join(repoPath, 'docs', 'prd')
    await mkdir(prdDir, { recursive: true })

    await writeFile(join(prdDir, 'alpha.md'), '# Alpha\n')
    await writeFile(join(prdDir, 'beta.md'), '# Beta\n')

    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { upsertPrdState } = await import('../dist/server/utils/prd-state.js')
    const { resolveLauncherContext } = await import('../dist/host/src/launcher/context.js')
    const { bootstrapLauncher } = await import('../dist/host/src/launcher/bootstrap.js')

    const repo = await addRepo(repoPath, 'Launcher Repo')

    await upsertPrdState(repo.id, 'alpha', buildState('alpha', 'Alpha', [
      createTask('T01', 'completed'),
      createTask('T02', 'pending')
    ]))

    await upsertPrdState(repo.id, 'beta', buildState('beta', 'Beta', [
      createTask('T01', 'completed')
    ]))

    const autoResolved = await resolveLauncherContext({ repoHint: repo.id })
    assert.equal(autoResolved.repoId, repo.id)
    assert.equal(autoResolved.prdSlug, 'alpha')
    assert.equal(autoResolved.prdSource, 'actionable')

    const bootstrap = await bootstrapLauncher({
      repoHint: repo.id,
      prdSlug: 'beta',
      manageEngine: false
    })
    assert.equal(bootstrap.runtime.mode, 'launcher')
    assert.ok(bootstrap.runtime.launcher)
    assert.equal(bootstrap.runtime.launcher.context?.prdSlug, 'beta')
    assert.equal(bootstrap.runtime.launcher.context?.prdSource, 'explicit')
    assert.equal(bootstrap.runtime.launcher.engine.state, 'stopped')
    assert.match(bootstrap.runtime.launcher.engine.message, /not started/i)

    const capabilities = bootstrap.runtime.launcher.capabilities
    const workspaceCapability = capabilities.find((capability) => capability.id === 'workspaceContext')
    assert.ok(workspaceCapability)
    assert.equal(workspaceCapability.available, true)
    assert.ok(capabilities.some((capability) => capability.available === false))

    await bootstrap.shutdown()
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('launcher context throws a helpful error for unknown explicit PRD slug', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-launcher-missing-prd-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const repoPath = join(tempRoot, 'repo-launcher-missing')
    const prdDir = join(repoPath, 'docs', 'prd')
    await mkdir(prdDir, { recursive: true })
    await writeFile(join(prdDir, 'known.md'), '# Known\n')

    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { resolveLauncherContext } = await import('../dist/host/src/launcher/context.js')

    const repo = await addRepo(repoPath, 'Launcher Missing Repo')

    await assert.rejects(
      () => resolveLauncherContext({ repoHint: repo.id, prdSlug: 'missing' }),
      /Available slugs: known/
    )
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
