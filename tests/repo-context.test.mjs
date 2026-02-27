import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('requireCurrentRepo resolves by cwd when multiple repos are registered', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'steward-test-'))
  const previousDbPath = process.env.PRD_STATE_DB_PATH
  const originalCwd = process.cwd()
  process.env.PRD_STATE_DB_PATH = join(tempRoot, 'state.db')

  try {
    const { addRepo } = await import('../dist/server/utils/repos.js')
    const { requireCurrentRepo } = await import('../dist/host/src/api/repo-context.js')

    const repoAPath = join(tempRoot, 'repo-a')
    const repoBPath = join(tempRoot, 'repo-b')
    const repoBSubdir = join(repoBPath, 'docs')

    await mkdir(join(repoAPath, 'docs', 'prd'), { recursive: true })
    await mkdir(join(repoBPath, 'docs', 'prd'), { recursive: true })

    const repoA = await addRepo(repoAPath, 'Repo A')
    const repoB = await addRepo(repoBPath, 'Repo B')

    process.chdir(repoBSubdir)
    const resolved = await requireCurrentRepo()
    assert.equal(resolved.id, repoB.id)

    process.chdir(tempRoot)
    await assert.rejects(
      () => requireCurrentRepo(),
      (error) => {
        assert.equal(error.code, 'AMBIGUOUS_REPO')
        assert.match(error.message, /working directory does not map to a registered repo/i)
        return true
      }
    )

    assert.notEqual(repoA.id, repoB.id)
  } finally {
    process.chdir(originalCwd)

    if (previousDbPath === undefined) {
      delete process.env.PRD_STATE_DB_PATH
    } else {
      process.env.PRD_STATE_DB_PATH = previousDbPath
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
