import { removeRepo } from '~~/server/utils/repos'
import { refreshWatcher } from '~~/server/utils/watcher'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'repoId')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required'
    })
  }

  const removed = await removeRepo(id)

  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  // Refresh file watcher to remove repo from watch list
  await refreshWatcher()

  return { success: true }
})
