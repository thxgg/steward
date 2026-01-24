import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  let path = (query.path as string) || homedir()

  // Expand ~ to home directory
  if (path.startsWith('~')) {
    path = path.replace('~', homedir())
  }

  try {
    const stats = await stat(path)
    if (!stats.isDirectory()) {
      throw createError({
        statusCode: 400,
        message: 'Path is not a directory'
      })
    }

    const entries = await readdir(path, { withFileTypes: true })
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: join(path, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      current: path,
      parent: join(path, '..'),
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
