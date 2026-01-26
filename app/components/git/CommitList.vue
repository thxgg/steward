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

// Fetched commit details (keyed by sha for lookup)
const commitDetails = ref<Map<string, GitCommit>>(new Map())

// Track commits that failed to load
const failedCommits = ref<Set<string>>(new Set())

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
          commits: result.commits.map(c => ({ ...c, repoPath })),
          failedShas: result.failedShas,
        }
      })
    )

    // Build map of sha -> commit details and collect failed SHAs
    const detailsMap = new Map<string, GitCommit>()
    const failed = new Set<string>()

    for (const { commits: repoCommits, failedShas } of results) {
      for (const commit of repoCommits) {
        // Key by shortSha since props contain abbreviated SHAs
        detailsMap.set(commit.shortSha, commit)
      }
      for (const sha of failedShas) {
        failed.add(sha)
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

// Get commit details by SHA (supports prefix matching for abbreviated SHAs)
function getDetails(sha: string): GitCommit | undefined {
  // Direct lookup first
  const direct = commitDetails.value.get(sha)
  if (direct) return direct

  // Try prefix matching (short SHA might be abbreviated differently)
  for (const [key, commit] of commitDetails.value) {
    if (key.startsWith(sha) || sha.startsWith(key)) {
      return commit
    }
  }
  return undefined
}

// Check if a commit failed to load (supports prefix matching)
function isFailed(sha: string): boolean {
  if (failedCommits.value.has(sha)) return true

  // Try prefix matching
  for (const failedSha of failedCommits.value) {
    if (failedSha.startsWith(sha) || sha.startsWith(failedSha)) {
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
        :key="commit.sha"
        class="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
        @click="handleClick(commit)"
      >
        <div class="flex items-start gap-3">
          <GitCommitIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <!-- SHA, stats, and repo badge -->
            <div class="flex flex-wrap items-center gap-2">
              <code class="font-mono text-xs font-medium text-primary">
                {{ getDetails(commit.sha)?.shortSha || commit.sha.substring(0, 7) }}
              </code>
              <template v-if="getDetails(commit.sha)">
                <span class="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText class="size-3" />
                  {{ getDetails(commit.sha)!.filesChanged }}
                </span>
                <span class="flex items-center gap-0.5 text-xs text-green-600 dark:text-green-400">
                  <Plus class="size-3" />{{ getDetails(commit.sha)!.additions }}
                </span>
                <span class="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400">
                  <Minus class="size-3" />{{ getDetails(commit.sha)!.deletions }}
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
              <template v-if="getDetails(commit.sha)">
                {{ getDetails(commit.sha)!.message }}
              </template>
              <span v-else-if="isFailed(commit.sha)" class="flex items-center gap-1 text-muted-foreground">
                <AlertCircle class="size-3" />
                Commit unavailable
              </span>
              <span v-else class="text-muted-foreground">Loading...</span>
            </p>

            <!-- Author and date -->
            <p v-if="getDetails(commit.sha)" class="mt-1 text-xs text-muted-foreground">
              {{ getDetails(commit.sha)!.author }} &middot; {{ formatRelativeDate(getDetails(commit.sha)!.date) }}
            </p>
          </div>
        </div>
      </button>
    </template>
  </div>
</template>
