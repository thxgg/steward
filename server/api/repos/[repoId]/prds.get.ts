import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { getRepos } from '~~/server/utils/repos'
import { getPrdStateSummaries, migrateLegacyStateForRepo } from '~~/server/utils/prd-state'
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

  await migrateLegacyStateForRepo(repo)

  const prdDir = join(repo.path, 'docs', 'prd')

  let prdFiles: string[] = []
  try {
    const files = await fs.readdir(prdDir)
    prdFiles = files.filter(f => f.endsWith('.md'))
  } catch {
    // docs/prd doesn't exist, return empty array
    return []
  }

  const stateSummaries = await getPrdStateSummaries(repo.id)

  const prds: PrdListItem[] = await Promise.all(
    prdFiles.map(async (filename) => {
      const slug = basename(filename, '.md')
      const filePath = join(prdDir, filename)

      // Get file modification time and extract title from first H1
      let name = slug
      let modifiedAt = 0
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath)
        ])
        modifiedAt = stat.mtime.getTime()
        const h1Match = content.match(/^#\s+(.+)$/m)
        if (h1Match && h1Match[1]) {
          name = h1Match[1].trim()
        }
      } catch {
        // Couldn't read file, use slug as name
      }

      const stateSummary = stateSummaries.get(slug)
      const hasState = !!stateSummary?.hasState
      const taskCount = stateSummary?.taskCount
      const completedCount = stateSummary?.completedCount

      return {
        slug,
        name,
        source: `docs/prd/${filename}`,
        hasState,
        modifiedAt,
        ...(taskCount !== undefined && { taskCount }),
        ...(completedCount !== undefined && { completedCount })
      }
    })
  )

  // Sort by modification time descending (most recent first)
  prds.sort((a, b) => b.modifiedAt - a.modifiedAt)

  return prds
})
