<script setup lang="ts">
import { FileText, Loader2, AlertCircle, RefreshCw, GitBranch } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'

const route = useRoute()
const { prds, prdsStatus, showArchived, setShowArchived, refreshPrds } = usePrd()
const { currentRepoId } = useRepos()

// Determine which PRD is currently selected based on route
const currentPrdSlug = computed(() => {
  return route.params.prd as string | undefined
})

// Check if a PRD is the current one
function isActive(slug: string): boolean {
  return currentPrdSlug.value === slug
}

const repoGraphHref = computed(() => {
  if (!currentRepoId.value) {
    return '/'
  }

  return `/${currentRepoId.value}/repo-graph`
})

const isRepoGraphActive = computed(() => {
  if (!currentRepoId.value) {
    return false
  }

  return route.path === `/${currentRepoId.value}/repo-graph`
})
</script>

<template>
  <aside class="flex h-full w-64 flex-col border-r border-border bg-background">
    <!-- PRD List -->
    <ScrollArea class="flex-1">
      <div class="p-2">
        <NuxtLink
          v-if="currentRepoId"
          :to="repoGraphHref"
          class="group mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
          :class="[
            isRepoGraphActive
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          ]"
        >
          <GitBranch class="size-4 shrink-0" />
          <span class="flex-1 truncate">Repo Graph</span>
        </NuxtLink>

        <!-- Documents Header -->
        <div class="flex h-10 items-center justify-between gap-2 px-2">
          <h2 class="text-sm font-medium text-muted-foreground">Documents</h2>
          <div class="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            <span id="sidebar-show-archived-label">Show archived</span>
            <Switch
              :model-value="showArchived"
              aria-labelledby="sidebar-show-archived-label"
              @update:model-value="setShowArchived"
            />
          </div>
        </div>
        <!-- Loading state -->
        <div v-if="prdsStatus === 'pending'" class="flex items-center justify-center py-8">
          <Loader2 class="size-5 animate-spin text-muted-foreground" />
        </div>

        <!-- No repo selected -->
        <div v-else-if="!currentRepoId" class="px-2 py-8 text-center">
          <p class="text-sm text-muted-foreground">
            Select a repository to view PRDs
          </p>
        </div>

        <!-- Error state -->
        <div v-else-if="prdsStatus === 'error'" class="px-2 py-8 text-center">
          <AlertCircle class="mx-auto size-8 text-destructive/50" />
          <p class="mt-2 text-sm text-muted-foreground">
            Failed to load PRDs
          </p>
          <Button variant="ghost" size="sm" class="mt-2" @click="refreshPrds">
            <RefreshCw class="mr-1 size-3" />
            Retry
          </Button>
        </div>

        <!-- Empty state -->
        <div v-else-if="!prds?.length" class="px-2 py-8 text-center">
          <FileText class="mx-auto size-8 text-muted-foreground/50" />
          <p class="mt-2 text-sm text-muted-foreground">
            {{ showArchived ? 'No PRDs found' : 'No active PRDs found' }}
          </p>
          <p class="mt-1 text-xs text-muted-foreground/70">
            {{ showArchived ? 'Add .md files to docs/prd/' : 'Archived PRDs are hidden. Use the archive toggle above.' }}
          </p>
        </div>

        <!-- PRD items -->
        <nav v-else class="space-y-1">
          <NuxtLink
            v-for="prd in prds"
            :key="prd.slug"
            :to="`/${currentRepoId}/${prd.slug}`"
            class="group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
            :class="[
              isActive(prd.slug)
                ? 'bg-accent text-accent-foreground'
                : prd.archived
                  ? 'text-muted-foreground/75 hover:bg-accent/40 hover:text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            ]"
          >
            <FileText class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ prd.name }}</span>
            <Badge
              v-if="prd.archived"
              variant="outline"
              class="shrink-0 text-[10px] uppercase tracking-wide"
            >
              Archived
            </Badge>
            <Badge
              v-if="prd.hasState && prd.taskCount"
              variant="secondary"
              class="shrink-0 text-xs"
            >
              {{ prd.completedCount ?? 0 }}/{{ prd.taskCount }}
            </Badge>
          </NuxtLink>
        </nav>
      </div>
    </ScrollArea>
  </aside>
</template>
