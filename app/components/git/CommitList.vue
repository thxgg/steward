<script setup lang="ts">
import { GitCommit as GitCommitIcon, Plus, Minus, FileText, FolderGit2, AlertCircle } from 'lucide-vue-next'
import { Badge } from '~/components/ui/badge'
import type { GitCommit } from '~/types/git'
import type { CommitRef } from '~/types/task'

const props = defineProps<{
  /** Array of commits to display - expects CommitRef objects with sha and repo */
  commits: CommitRef[]
  /** Repository ID for API calls */
  repoId: string
}>()

const emit = defineEmits<{
  select: [sha: string, repo?: string]
}>()

const { fetchCommits, isLoadingCommits } = useGit()

// Fetched commit details keyed by repo + requested SHA.
const commitDetails = ref<Map<string, GitCommit>>(new Map())

// Track commits that failed to load using the same key shape.
const failedCommits = ref<Set<string>>(new Set())

function toShaLookupValue(sha: string): string {
  return sha.trim().toLowerCase()
}

function toRepoLookupValue(repo: string | undefined): string {
  return (repo || '').trim()
}

function createCommitKey(sha: string, repo: string | undefined): string {
  return `${toRepoLookupValue(repo)}::${toShaLookupValue(sha)}`
}

function matchesRequestedSha(requestedSha: string, commit: GitCommit): boolean {
  const requested = toShaLookupValue(requestedSha)
  const fullSha = toShaLookupValue(commit.sha)
  const shortSha = toShaLookupValue(commit.shortSha)

  return fullSha === requested
    || shortSha === requested
    || fullSha.startsWith(requested)
    || requested.startsWith(fullSha)
    || shortSha.startsWith(requested)
    || requested.startsWith(shortSha)
}

// Check if any commits have repo info (indicates pseudo-monorepo)
const hasMultipleRepos = computed(() => {
  const repos = new Set(props.commits.map(c => c.repo).filter(Boolean))
  return repos.size > 1
})

// Fetch commit details when props change
// Group commits by repo to make efficient API calls
watch(
  () => ({ commits: props.commits, repoId: props.repoId }),
  async ({ commits, repoId }) => {
    if (commits.length === 0 || !repoId) {
      commitDetails.value = new Map()
      failedCommits.value = new Set()
      return
    }

    // Group commits by repo
    const commitsByRepo = new Map<string, string[]>()
    for (const commit of commits) {
      const repoPath = commit.repo || ''
      if (!commitsByRepo.has(repoPath)) {
        commitsByRepo.set(repoPath, [])
      }
      commitsByRepo.get(repoPath)!.push(commit.sha)
    }

    // Fetch commits for each repo in parallel
    const results = await Promise.all(
      Array.from(commitsByRepo.entries()).map(async ([repoPath, shas]) => {
        const result = await fetchCommits(repoId, shas, repoPath || undefined)
        return {
          repoPath,
          requestedShas: [...shas],
          commits: result.commits,
          failedShas: result.failedShas
        }
      })
    )

    // Build map of requested commit key -> commit details and collect failures.
    const detailsMap = new Map<string, GitCommit>()
    const failed = new Set<string>()

    for (const { repoPath, requestedShas, commits: repoCommits, failedShas } of results) {
      const remainingCommits = [...repoCommits]

      for (const requestedSha of requestedShas) {
        const key = createCommitKey(requestedSha, repoPath)
        const matchIndex = remainingCommits.findIndex((commit) => matchesRequestedSha(requestedSha, commit))

        if (matchIndex >= 0) {
          const [matchedCommit] = remainingCommits.splice(matchIndex, 1)
          if (matchedCommit) {
            detailsMap.set(key, {
              ...matchedCommit,
              repoPath
            })
            continue
          }
        }

        failed.add(key)
      }

      for (const sha of failedShas) {
        failed.add(createCommitKey(sha, repoPath))
      }
    }

    commitDetails.value = detailsMap
    failedCommits.value = failed
  },
  { immediate: true }
)

// Format relative date
function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  } else {
    return date.toLocaleDateString()
  }
}

function handleClick(commit: CommitRef) {
  emit('select', commit.sha, commit.repo)
}

// Get commit details by commit reference.
function getDetails(commitRef: CommitRef): GitCommit | undefined {
  const direct = commitDetails.value.get(createCommitKey(commitRef.sha, commitRef.repo))
  if (direct) {
    return direct
  }

  const requestedSha = toShaLookupValue(commitRef.sha)
  const repoPrefix = `${toRepoLookupValue(commitRef.repo)}::`

  for (const [key, commit] of commitDetails.value) {
    if (!key.startsWith(repoPrefix)) {
      continue
    }

    const storedSha = key.slice(repoPrefix.length)
    if (storedSha.startsWith(requestedSha) || requestedSha.startsWith(storedSha)) {
      return commit
    }
  }

  return undefined
}

// Check if a commit failed to load.
function isFailed(commitRef: CommitRef): boolean {
  const directKey = createCommitKey(commitRef.sha, commitRef.repo)
  if (failedCommits.value.has(directKey)) {
    return true
  }

  const requestedSha = toShaLookupValue(commitRef.sha)
  const repoPrefix = `${toRepoLookupValue(commitRef.repo)}::`

  for (const failedKey of failedCommits.value) {
    if (!failedKey.startsWith(repoPrefix)) {
      continue
    }

    const failedSha = failedKey.slice(repoPrefix.length)
    if (failedSha.startsWith(requestedSha) || requestedSha.startsWith(failedSha)) {
      return true
    }
  }

  return false
}
</script>

<template>
  <div class="space-y-2">
    <!-- Loading skeleton -->
    <template v-if="isLoadingCommits">
      <div
        v-for="i in Math.min(commits.length, 3)"
        :key="i"
        class="animate-pulse rounded-lg border bg-muted/50 p-3"
      >
        <div class="flex items-start gap-3">
          <div class="h-5 w-5 rounded bg-muted" />
          <div class="flex-1 space-y-2">
            <div class="h-4 w-20 rounded bg-muted" />
            <div class="h-4 w-3/4 rounded bg-muted" />
            <div class="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div
      v-else-if="commits.length === 0"
      class="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
    >
      No commits recorded for this task
    </div>

    <!-- Commit list -->
    <template v-else>
      <button
        v-for="commit in commits"
        :key="`${commit.repo || ''}:${commit.sha}`"
        class="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
        @click="handleClick(commit)"
      >
        <div class="flex items-start gap-3">
          <GitCommitIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <!-- SHA, stats, and repo badge -->
            <div class="flex flex-wrap items-center gap-2">
              <code class="font-mono text-xs font-medium text-primary">
                {{ getDetails(commit)?.shortSha || commit.sha.substring(0, 7) }}
              </code>
              <template v-if="getDetails(commit)">
                <span class="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText class="size-3" />
                  {{ getDetails(commit)!.filesChanged }}
                </span>
                <span class="flex items-center gap-0.5 text-xs text-green-600 dark:text-green-400">
                  <Plus class="size-3" />{{ getDetails(commit)!.additions }}
                </span>
                <span class="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400">
                  <Minus class="size-3" />{{ getDetails(commit)!.deletions }}
                </span>
              </template>
              <!-- Repo badge - only show for pseudo-monorepos with multiple repos -->
              <Badge v-if="commit.repo && hasMultipleRepos" variant="secondary" class="gap-1 text-xs">
                <FolderGit2 class="size-3" />
                {{ commit.repo }}
              </Badge>
            </div>

            <!-- Message -->
            <p class="mt-1 truncate text-sm">
              <template v-if="getDetails(commit)">
                {{ getDetails(commit)!.message }}
              </template>
              <span v-else-if="isFailed(commit)" class="flex items-center gap-1 text-muted-foreground">
                <AlertCircle class="size-3" />
                Commit unavailable
              </span>
              <span v-else class="text-muted-foreground">Loading...</span>
            </p>

            <!-- Author and date -->
            <p v-if="getDetails(commit)" class="mt-1 text-xs text-muted-foreground">
              {{ getDetails(commit)!.author }} &middot; {{ formatRelativeDate(getDetails(commit)!.date) }}
            </p>
          </div>
        </div>
      </button>
    </template>
  </div>
</template>
