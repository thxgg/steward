import { getRepos } from '~~/server/utils/repos'
import { buildRepoGraph } from '~~/server/utils/task-graph'

function parseIncludeArchived(rawValue: unknown): boolean {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue

  if (value === undefined) {
    return false
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized.length === 0 || normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false
    }

    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true
    }
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid includeArchived query value'
  })
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const includeArchived = parseIncludeArchived(getQuery(event).includeArchived)

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required'
    })
  }

  const repos = await getRepos()
  const repo = repos.find((entry) => entry.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  try {
    return await buildRepoGraph(repo, { includeArchived })
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to build repository graph',
      message: (error as Error).message.replace(/\s+/g, ' ').trim()
    })
  }
})
