import type { PrdListItem } from '../../../app/types/prd.js'
import type { RepoConfig } from '../../../app/types/repo.js'
import type { LauncherPrdSource, LauncherResolvedContext } from '../../../app/types/launcher.js'
import { listPrdDocuments } from '../../../server/utils/prd-service.js'
import {
  RepoLookupError,
  requireCurrentRepo,
  requireRepo,
  requireRepoByPath
} from '../api/repo-context.js'

export interface ResolveLauncherContextOptions {
  repoHint?: string
  prdSlug?: string
}

function compareByRecencyThenSlug(left: PrdListItem, right: PrdListItem): number {
  const modifiedDiff = right.modifiedAt - left.modifiedAt
  if (modifiedDiff !== 0) {
    return modifiedDiff
  }

  return left.slug.localeCompare(right.slug)
}

function hasActionableState(prd: PrdListItem): boolean {
  if (!prd.hasState) {
    return false
  }

  if (typeof prd.taskCount !== 'number' || prd.taskCount <= 0) {
    return false
  }

  const completedCount = typeof prd.completedCount === 'number' ? prd.completedCount : 0
  return completedCount < prd.taskCount
}

function pickPrdCandidate(prds: PrdListItem[]): { slug: string | null; source: LauncherPrdSource } {
  if (prds.length === 0) {
    return {
      slug: null,
      source: 'none'
    }
  }

  const actionable = prds.filter(hasActionableState).sort(compareByRecencyThenSlug)
  if (actionable[0]) {
    return {
      slug: actionable[0].slug,
      source: 'actionable'
    }
  }

  const withState = prds.filter((prd) => prd.hasState).sort(compareByRecencyThenSlug)
  if (withState[0]) {
    return {
      slug: withState[0].slug,
      source: 'stateful'
    }
  }

  const latest = [...prds].sort(compareByRecencyThenSlug)
  if (latest[0]) {
    return {
      slug: latest[0].slug,
      source: 'latest'
    }
  }

  return {
    slug: null,
    source: 'none'
  }
}

function formatAvailableSlugs(prds: PrdListItem[]): string {
  if (prds.length === 0) {
    return '<none>'
  }

  const slugs = [...new Set(prds.map((prd) => prd.slug))].sort((left, right) => left.localeCompare(right))
  return slugs.join(', ')
}

async function resolveRepo(repoHint?: string): Promise<RepoConfig> {
  const trimmedHint = repoHint?.trim()
  if (!trimmedHint) {
    return await requireCurrentRepo()
  }

  try {
    return await requireRepo(trimmedHint)
  } catch (repoIdError) {
    if (repoIdError instanceof RepoLookupError && repoIdError.code === 'NO_REPOS') {
      throw repoIdError
    }

    try {
      return await requireRepoByPath(trimmedHint)
    } catch (repoPathError) {
      if (repoPathError instanceof RepoLookupError && repoPathError.code === 'NO_REPOS') {
        throw repoPathError
      }

      const byIdMessage = repoIdError instanceof Error ? repoIdError.message : String(repoIdError)
      const byPathMessage = repoPathError instanceof Error ? repoPathError.message : String(repoPathError)
      throw new Error(
        `Unable to resolve repository from "${trimmedHint}". Tried repo id and absolute path. byId: ${byIdMessage}. byPath: ${byPathMessage}`
      )
    }
  }
}

function filterAutoSelectionPrds(prds: PrdListItem[]): PrdListItem[] {
  const nonArchived = prds.filter((prd) => !prd.archived)
  return nonArchived.length > 0 ? nonArchived : prds
}

export async function resolveLauncherContext(
  options: ResolveLauncherContextOptions = {}
): Promise<LauncherResolvedContext> {
  const repo = await resolveRepo(options.repoHint)
  const allPrds = await listPrdDocuments(repo, { includeArchived: true })
  const selectionPrds = filterAutoSelectionPrds(allPrds)

  const explicitPrdSlug = options.prdSlug?.trim()
  if (explicitPrdSlug) {
    const explicitPrd = allPrds.find((prd) => prd.slug === explicitPrdSlug)
    if (!explicitPrd) {
      throw new Error(
        `PRD slug "${explicitPrdSlug}" was not found in repository "${repo.name}". Available slugs: ${formatAvailableSlugs(allPrds)}`
      )
    }

    return {
      repoId: repo.id,
      repoName: repo.name,
      repoPath: repo.path,
      prdSlug: explicitPrd.slug,
      prdSource: 'explicit'
    }
  }

  const picked = pickPrdCandidate(selectionPrds)
  return {
    repoId: repo.id,
    repoName: repo.name,
    repoPath: repo.path,
    prdSlug: picked.slug,
    prdSource: picked.source
  }
}
