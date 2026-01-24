import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { getRepos } from '~~/server/utils/repos'
import type { PrdListItem } from '~~/app/types/prd'

export default defineEventHandler(async (event) => {
  const repoId = getRouterParam(event, 'repoId')

  if (!repoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Repository ID is required'
    })
  }

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  const prdDir = join(repo.path, 'docs', 'prd')
  const stateDir = join(repo.path, '.claude', 'state')

  let prdFiles: string[] = []
  try {
    const files = await fs.readdir(prdDir)
    prdFiles = files.filter(f => f.endsWith('.md'))
  } catch {
    // docs/prd doesn't exist, return empty array
    return []
  }

  const prds: PrdListItem[] = await Promise.all(
    prdFiles.map(async (filename) => {
      const slug = basename(filename, '.md')
      const filePath = join(prdDir, filename)
      const stateSlugDir = join(stateDir, slug)

      // Read file to extract title from first H1
      let name = slug
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const h1Match = content.match(/^#\s+(.+)$/m)
        if (h1Match && h1Match[1]) {
          name = h1Match[1].trim()
        }
      } catch {
        // Couldn't read file, use slug as name
      }

      // Check if state directory exists
      let hasState = false
      let taskCount: number | undefined
      let completedCount: number | undefined

      try {
        await fs.stat(stateSlugDir)
        hasState = true

        // Try to read tasks.json to get counts
        const tasksPath = join(stateSlugDir, 'tasks.json')
        try {
          const tasksContent = await fs.readFile(tasksPath, 'utf-8')
          const tasksData = JSON.parse(tasksContent)
          if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
            taskCount = tasksData.tasks.length
            completedCount = tasksData.tasks.filter(
              (t: { status?: string }) => t.status === 'completed'
            ).length
          }
        } catch {
          // tasks.json doesn't exist or is invalid
        }
      } catch {
        // State directory doesn't exist
      }

      return {
        slug,
        name,
        source: `docs/prd/${filename}`,
        hasState,
        ...(taskCount !== undefined && { taskCount }),
        ...(completedCount !== undefined && { completedCount })
      }
    })
  )

  return prds
})
