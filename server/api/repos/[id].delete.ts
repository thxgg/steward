import { removeRepo } from '~~/server/utils/repos'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

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

  return { success: true }
})
