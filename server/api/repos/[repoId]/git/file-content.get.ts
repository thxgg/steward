import { getRepos } from '~~/server/utils/repos'
import { isGitRepo, getFileContent } from '~~/server/utils/git'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const query = getQuery(event)
  const commit = query.commit as string | undefined
  const file = query.file as string | undefined
  const repoPath = query.repo as string | undefined

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

  // Resolve the git repo path
  let gitRepoPath = repo.path

  if (repoPath) {
    // Validate that repoPath is within discovered gitRepos
    if (!repo.gitRepos || repo.gitRepos.length === 0) {
      throw createError({
        statusCode: 400,
        message: 'repo parameter provided but no git repos discovered in this repository',
      })
    }

    const matchedRepo = repo.gitRepos.find(gr => gr.relativePath === repoPath)
    if (!matchedRepo) {
      throw createError({
        statusCode: 400,
        message: `repo "${repoPath}" is not a discovered git repo. Available: ${repo.gitRepos.map(gr => gr.relativePath).join(', ')}`,
      })
    }

    gitRepoPath = matchedRepo.absolutePath
  }

  if (!await isGitRepo(gitRepoPath)) {
    throw createError({ statusCode: 400, message: 'Not a git repository' })
  }

  try {
    const content = await getFileContent(gitRepoPath, commit, file)
    return { content }
  } catch (error) {
    throw createError({
      statusCode: 404,
      message: error instanceof Error ? error.message : 'Failed to get file content'
    })
  }
})
