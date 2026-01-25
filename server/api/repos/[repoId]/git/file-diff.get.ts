import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getFileDiff, validatePathInRepo } from '~~/server/utils/git'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required',
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found',
    })
  }

  // Check if it's a git repository
  if (!await isGitRepo(repo.path)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository is not a git repository',
    })
  }

  // Get commit SHA and file path from query parameters
  const query = getQuery(event)
  const commit = query.commit as string | undefined
  const file = query.file as string | undefined

  if (!commit) {
    throw createError({
      statusCode: 400,
      statusMessage: 'commit query parameter is required',
    })
  }

  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: 'file query parameter is required',
    })
  }

  // Validate file path is within repo
  if (!validatePathInRepo(repo.path, file)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file path: path traversal not allowed',
    })
  }

  try {
    const hunks = await getFileDiff(repo.path, commit, file)
    return hunks
  } catch (error) {
    const message = (error as Error).message

    // Determine appropriate error code
    if (message.includes('Invalid commit SHA')) {
      throw createError({
        statusCode: 400,
        statusMessage: message,
      })
    }

    if (message.includes('outside repository')) {
      throw createError({
        statusCode: 400,
        statusMessage: message,
      })
    }

    throw createError({
      statusCode: 404,
      statusMessage: `File not found in commit or commit invalid: ${message}`,
    })
  }
})
