import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getRepos } from '~~/server/utils/repos'
import type { PrdDocument, PrdMetadata } from '~~/app/types/prd'

function parseMetadata(content: string): PrdMetadata {
  const metadata: PrdMetadata = {}

  // Look for metadata patterns in the document header
  // Formats: "**Author:** Value" or "Author: Value"

  // Author - match **Author:** or Author: and capture the value
  const authorMatch = content.match(/\*{0,2}Author\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (authorMatch && authorMatch[1]) {
    metadata.author = authorMatch[1].trim()
  }

  // Date
  const dateMatch = content.match(/\*{0,2}Date\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (dateMatch && dateMatch[1]) {
    metadata.date = dateMatch[1].trim()
  }

  // Status
  const statusMatch = content.match(/\*{0,2}Status\*{0,2}:\*{0,2}\s*(.+?)(?:\n|$)/i)
  if (statusMatch && statusMatch[1]) {
    metadata.status = statusMatch[1].trim()
  }

  // Shortcut Story - look for link format [SC-XXX](url) or just SC-XXX
  const shortcutLinkMatch = content.match(/\[([Ss][Cc]-\d+)\]\(([^)]+)\)/)
  if (shortcutLinkMatch && shortcutLinkMatch[1] && shortcutLinkMatch[2]) {
    metadata.shortcutStory = shortcutLinkMatch[1]
    metadata.shortcutUrl = shortcutLinkMatch[2]
  } else {
    // Try just the ID pattern
    const shortcutIdMatch = content.match(/\*{0,2}Shortcut(?:\s+Story)?\*{0,2}:\*{0,2}\s*([Ss][Cc]-\d+)/i)
    if (shortcutIdMatch && shortcutIdMatch[1]) {
      metadata.shortcutStory = shortcutIdMatch[1]
    }
  }

  return metadata
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

  const repos = await getRepos()
  const repo = repos.find(r => r.id === repoId)

  if (!repo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Repository not found'
    })
  }

  const prdPath = join(repo.path, 'docs', 'prd', `${prdSlug}.md`)

  let content: string
  try {
    content = await fs.readFile(prdPath, 'utf-8')
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: 'PRD not found'
    })
  }

  // Extract title from first H1
  let name = prdSlug
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match && h1Match[1]) {
    name = h1Match[1].trim()
  }

  // Parse metadata from document
  const metadata = parseMetadata(content)

  const document: PrdDocument = {
    slug: prdSlug,
    name,
    content,
    metadata
  }

  return document
})
