import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'

const browseQuerySchema = z.object({
  path: z.string().max(4096, 'Path is too long').optional()
}).passthrough()

function validationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid browse query',
    message
  })
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

export default defineEventHandler(async (event) => {
  const parsedQuery = browseQuerySchema.safeParse(getQuery(event))
  if (!parsedQuery.success) {
    validationError(parsedQuery.error.issues[0]?.message || 'Invalid query parameters')
  }

  const requestedPath = parsedQuery.data.path?.trim() || homedir()

  if (requestedPath.includes('\u0000')) {
    validationError('Path contains invalid characters')
  }

  // Expand ~ to home directory
  const expandedPath = requestedPath.startsWith('~')
    ? requestedPath.replace('~', homedir())
    : requestedPath

  if (expandedPath.length > 4096) {
    validationError('Path is too long')
  }

  const resolvedPath = resolve(expandedPath)

  try {
    const stats = await stat(resolvedPath)
    if (!stats.isDirectory()) {
      throw createError({
        statusCode: 400,
        message: 'Path is not a directory'
      })
    }

    const entries = await readdir(resolvedPath, { withFileTypes: true })
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: toPosixPath(join(resolvedPath, entry.name))
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const parentPath = dirname(resolvedPath)

    return {
      current: toPosixPath(resolvedPath),
      parent: parentPath === resolvedPath ? null : toPosixPath(parentPath),
      directories
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        message: 'Directory not found'
      })
    }
    if (err.code === 'EACCES') {
      throw createError({
        statusCode: 403,
        message: 'Permission denied'
      })
    }
    throw err
  }
})
