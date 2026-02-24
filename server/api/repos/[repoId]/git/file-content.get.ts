import { getRepos } from '~~/server/utils/repos'
import { findRepoForCommit, getFileContent, isGitRepo, validatePathInRepo } from '~~/server/utils/git'
import {
  buildRepoLookup,
  normalizeErrorMessage,
  parseCommitShaParam,
  parseGitFilePathParam,
  parseOptionalGitRepoPathParam,
  resolveRequestedGitRepoPath,
} from '~~/server/utils/git-api'

const MAX_FILE_CONTENT_CHARS = 1_000_000

function formatFileContentResponse(content: string) {
  if (content.length <= MAX_FILE_CONTENT_CHARS) {
    return { content }
  }

  return {
    content: content.slice(0, MAX_FILE_CONTENT_CHARS),
    truncated: true,
    maxChars: MAX_FILE_CONTENT_CHARS,
    originalChars: content.length,
    message: `File content was truncated to ${MAX_FILE_CONTENT_CHARS.toLocaleString()} characters.`
  }
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const query = getQuery(event)
  let commit: string
  let file: string
  let repoPath: string | undefined

  if (!repoId) {
    throw createError({ statusCode: 400, message: 'Repository ID is required' })
  }

  try {
    commit = parseCommitShaParam(query.commit, 'commit query parameter')
    file = parseGitFilePathParam(query.file)
    repoPath = parseOptionalGitRepoPathParam(query.repo)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid git query parameters',
      message: normalizeErrorMessage((error as Error).message),
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({ statusCode: 404, message: 'Repository not found' })
  }

  const repoLookup = await buildRepoLookup(repo)

  let gitRepoPath = repo.path
  if (repoPath) {
    try {
      const resolved = await resolveRequestedGitRepoPath(repoLookup, repoPath)
      gitRepoPath = resolved.gitRepoPath
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid repo path',
        message: normalizeErrorMessage((error as Error).message),
      })
    }
  }

  if (!await isGitRepo(gitRepoPath)) {
    const fallback = await findRepoForCommit(repoLookup, commit).catch(() => null)
    if (!fallback) {
      throw createError({ statusCode: 400, statusMessage: 'Not a git repository' })
    }
    gitRepoPath = fallback.absolutePath
  }

  if (!validatePathInRepo(gitRepoPath, file)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path', message: 'Path traversal not allowed' })
  }

  try {
    const content = await getFileContent(gitRepoPath, commit, file)
    return formatFileContentResponse(content)
  } catch (error) {
    const message = normalizeErrorMessage(error instanceof Error ? error.message : String(error))

    const fallback = await findRepoForCommit(repoLookup, commit).catch(() => null)
    if (fallback && fallback.absolutePath !== gitRepoPath && validatePathInRepo(fallback.absolutePath, file)) {
      try {
        const content = await getFileContent(fallback.absolutePath, commit, file)
        return formatFileContentResponse(content)
      } catch {
        // Keep original error below for clearer context.
      }
    }

    if (message.includes('Invalid commit SHA')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid commit SHA',
        message,
      })
    }

    if (message.includes('outside repository')) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid file path',
        message,
      })
    }

    throw createError({
      statusCode: 404,
      statusMessage: 'Failed to get file content',
      message,
    })
  }
})
