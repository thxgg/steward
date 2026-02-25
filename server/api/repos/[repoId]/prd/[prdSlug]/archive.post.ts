import { z } from 'zod'
import { setPrdArchived } from '~~/server/utils/prd-archive'
import { assertValidPrdSlug, readPrdDocument } from '~~/server/utils/prd-service'
import { getRepoById } from '~~/server/utils/repos'

const archiveBodySchema = z.object({
  archived: z.boolean()
}).strict()

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim()
}

function getValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message || 'Invalid request body'
}

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')
  const prdSlug = getRouterParam(event, 'prdSlug')

  if (!repoId || !prdSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID and PRD slug are required'
    })
  }

  try {
    assertValidPrdSlug(prdSlug)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid PRD slug',
      message: normalizeErrorMessage((error as Error).message)
    })
  }

  const body = await readBody<unknown>(event)
  const parsedBody = archiveBodySchema.safeParse(body)

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      message: getValidationMessage(parsedBody.error)
    })
  }

  const repo = await getRepoById(repoId)
  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  try {
    await readPrdDocument(repo, prdSlug)
  } catch (error) {
    const message = normalizeErrorMessage((error as Error).message)

    if (message.includes('PRD not found')) {
      throw createError({
        statusCode: 404,
        statusMessage: 'PRD not found'
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to validate PRD before archiving',
      message
    })
  }

  try {
    const archiveState = await setPrdArchived(repo.id, prdSlug, parsedBody.data.archived)
    return {
      slug: prdSlug,
      ...archiveState
    }
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update PRD archive state',
      message: normalizeErrorMessage((error as Error).message)
    })
  }
})
