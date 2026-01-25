<script setup lang="ts">
import { GitCommit as GitCommitIcon, Plus, Minus, FileText } from 'lucide-vue-next'
import type { GitCommit } from '~/types/git'
import type { CommitRef } from '~/types/task'

const props = defineProps<{
  /** Array of commit SHAs to display - supports both legacy strings and CommitRef objects */
  commits: (string | CommitRef)[]
  /** Repository ID for API calls */
  repoId: string
}>()

const emit = defineEmits<{
  select: [sha: string]
}>()

const { fetchCommits, isLoadingCommits } = useGit()

// Fetched commit details
const commitDetails = ref<GitCommit[]>([])

// Extract SHA from commit entry (handles both string and CommitRef)
function getSha(commit: string | CommitRef): string {
  return typeof commit === 'string' ? commit : commit.sha
}

// Get all SHAs from commits array
const commitShas = computed(() => props.commits.map(getSha))

// Fetch commit details when props change
watch(
  () => ({ commits: props.commits, repoId: props.repoId }),
  async ({ commits, repoId }) => {
    if (commits.length > 0 && repoId) {
      const shas = commits.map(getSha)
      commitDetails.value = await fetchCommits(repoId, shas)
    } else {
      commitDetails.value = []
    }
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

function handleClick(sha: string) {
  emit('select', sha)
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
        v-for="commit in commitDetails"
        :key="commit.sha"
        class="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
        @click="handleClick(commit.sha)"
      >
        <div class="flex items-start gap-3">
          <GitCommitIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <!-- SHA and stats -->
            <div class="flex items-center gap-2">
              <code class="font-mono text-xs font-medium text-primary">
                {{ commit.shortSha }}
              </code>
              <span class="flex items-center gap-1 text-xs text-muted-foreground">
                <FileText class="size-3" />
                {{ commit.filesChanged }}
              </span>
              <span class="flex items-center gap-0.5 text-xs text-green-600 dark:text-green-400">
                <Plus class="size-3" />{{ commit.additions }}
              </span>
              <span class="flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400">
                <Minus class="size-3" />{{ commit.deletions }}
              </span>
            </div>

            <!-- Message -->
            <p class="mt-1 truncate text-sm">
              {{ commit.message }}
            </p>

            <!-- Author and date -->
            <p class="mt-1 text-xs text-muted-foreground">
              {{ commit.author }} &middot; {{ formatRelativeDate(commit.date) }}
            </p>
          </div>
        </div>
      </button>
    </template>
  </div>
</template>
