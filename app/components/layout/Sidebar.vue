<script setup lang="ts">
import { FileText, Loader2, AlertCircle, RefreshCw } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

const route = useRoute()
const { prds, prdsStatus, refreshPrds } = usePrd()
const { currentRepoId } = useRepos()

// Determine which PRD is currently selected based on route
const currentPrdSlug = computed(() => {
  return route.params.prd as string | undefined
})

// Check if a PRD is the current one
function isActive(slug: string): boolean {
  return currentPrdSlug.value === slug
}
</script>

<template>
  <aside class="flex h-full w-64 flex-col border-r border-border bg-background">
    <!-- PRD List -->
    <ScrollArea class="flex-1">
      <div class="p-2">
        <!-- Documents Header -->
        <h2 class="flex h-10 items-center px-2 text-sm font-medium text-muted-foreground">Documents</h2>
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
            No PRDs found
          </p>
          <p class="mt-1 text-xs text-muted-foreground/70">
            Add .md files to docs/prd/
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
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            ]"
          >
            <FileText class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ prd.name }}</span>
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
