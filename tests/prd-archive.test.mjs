import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function createTasksFile(name, slug, taskId) {
  return {
    prd: {
      name,
      source: `docs/prd/${slug}.md`,
      createdAt: new Date().toISOString()
    },
    tasks: [
      {
        id: taskId,
        category: 'feature',
        title: `Task for ${slug}`,
        description: 'Implement feature',
        steps: ['step'],
        passes: [],
        dependencies: [],
        priority: 'high',
        status: 'pending'
      }
    ]
  }
}

test('archived PRDs are hidden by default but still readable', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-prd-archive-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { setPrdArchived } = await import('../dist/server/utils/prd-archive.js')
    const { listPrdDocuments, readPrdDocument } = await import('../dist/server/utils/prd-service.js')

    const repoPath = join(tempRoot, 'repo')
    await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })
    await writeFile(join(repoPath, 'docs', 'prd', 'active-prd.md'), '# Active PRD\n\nStill active.')
    await writeFile(join(repoPath, 'docs', 'prd', 'archived-prd.md'), '# Archived PRD\n\nStill exists.')

    const repo = await addRepo(repoPath, 'Archive Repo')

    const initialList = await listPrdDocuments(repo)
    assert.equal(initialList.length, 2)
    assert.ok(initialList.every((item) => item.archived === false))

    const archivedState = await setPrdArchived(repo.id, 'archived-prd', true)
    assert.equal(archivedState.archived, true)
    assert.ok(archivedState.archivedAt)

    const activeOnlyList = await listPrdDocuments(repo)
    assert.equal(activeOnlyList.length, 1)
    assert.equal(activeOnlyList[0]?.slug, 'active-prd')

    const fullList = await listPrdDocuments(repo, { includeArchived: true })
    assert.equal(fullList.length, 2)

    const archivedListItem = fullList.find((item) => item.slug === 'archived-prd')
    assert.ok(archivedListItem)
    assert.equal(archivedListItem?.archived, true)

    const archivedDocument = await readPrdDocument(repo, 'archived-prd')
    assert.equal(archivedDocument.archived, true)
    assert.match(archivedDocument.content, /Still exists\./)

    const markdownContent = await readFile(join(repoPath, 'docs', 'prd', 'archived-prd.md'), 'utf-8')
    assert.match(markdownContent, /Still exists\./)

    const restoredState = await setPrdArchived(repo.id, 'archived-prd', false)
    assert.equal(restoredState.archived, false)

    const restoredList = await listPrdDocuments(repo)
    assert.equal(restoredList.length, 2)
    assert.ok(restoredList.every((item) => item.archived === false))
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('repo graph excludes archived PRDs unless includeArchived is enabled', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-prd-archive-graph-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { setPrdArchived } = await import('../dist/server/utils/prd-archive.js')
    const { upsertPrdState } = await import('../dist/server/utils/prd-state.js')
    const { buildRepoGraph } = await import('../dist/server/utils/task-graph.js')

    const repoPath = join(tempRoot, 'repo')
    await mkdir(join(repoPath, 'docs', 'prd'), { recursive: true })
    await writeFile(join(repoPath, 'docs', 'prd', 'active-prd.md'), '# Active PRD')
    await writeFile(join(repoPath, 'docs', 'prd', 'archived-prd.md'), '# Archived PRD')

    const repo = await addRepo(repoPath, 'Archive Graph Repo')

    await upsertPrdState(repo.id, 'active-prd', {
      tasks: createTasksFile('Active PRD', 'active-prd', 'task-active')
    })

    await upsertPrdState(repo.id, 'archived-prd', {
      tasks: createTasksFile('Archived PRD', 'archived-prd', 'task-archived')
    })

    await setPrdArchived(repo.id, 'archived-prd', true)

    const defaultGraph = await buildRepoGraph(repo)
    assert.deepEqual(defaultGraph.prds, ['active-prd'])
    assert.equal(
      defaultGraph.nodes.some((node) => node.kind === 'task' && node.prdSlug === 'archived-prd'),
      false
    )

    const fullGraph = await buildRepoGraph(repo, { includeArchived: true })
    assert.equal(fullGraph.prds.includes('archived-prd'), true)
    assert.equal(
      fullGraph.nodes.some((node) => node.kind === 'task' && node.prdSlug === 'archived-prd'),
      true
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
