import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getRepos } from '~~/server/utils/repos'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')

  if (!repoId || !prdSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID and PRD slug are required'
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  const tasksPath = join(repo.path, '.claude', 'state', prdSlug, 'tasks.json')

  try {
    const content = await fs.readFile(tasksPath, 'utf-8')
    const data = JSON.parse(content)
    return data
  } catch (error) {
    // Check if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    // Invalid JSON
    if (error instanceof SyntaxError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Invalid JSON in tasks.json: ${error.message}`
      })
    }

    throw error
  }
})
