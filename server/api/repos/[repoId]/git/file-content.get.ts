import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getFileContent } from '~~/server/utils/git'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const query = getQuery(event)
  const commit = query.commit as string | undefined
  const file = query.file as string | undefined

  if (!repoId) {
    throw createError({ statusCode: 400, message: 'Repository ID is required' })
  }

  if (!commit) {
    throw createError({ statusCode: 400, message: 'Commit SHA is required' })
  }

  if (!file) {
    throw createError({ statusCode: 400, message: 'File path is required' })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({ statusCode: 404, message: 'Repository not found' })
  }

  if (!await isGitRepo(repo.path)) {
    throw createError({ statusCode: 400, message: 'Not a git repository' })
  }

  try {
    const content = await getFileContent(repo.path, commit, file)
    return { content }
  } catch (error) {
    throw createError({
      statusCode: 404,
      message: error instanceof Error ? error.message : 'Failed to get file content'
    })
  }
})
