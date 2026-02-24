import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  let path = (query.path as string) || homedir()

  // Expand ~ to home directory
  if (path.startsWith('~')) {
    path = path.replace('~', homedir())
  }

  const resolvedPath = resolve(path)

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
