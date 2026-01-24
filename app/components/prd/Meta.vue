<script setup lang="ts">
import { User, Calendar, CircleDot, ExternalLink } from 'lucide-vue-next'
import { Badge } from '~/components/ui/badge'
import type { PrdMetadata } from '~/types/prd'

const props = defineProps<{
  metadata: PrdMetadata
}>()

// Determine status color based on status text
const statusVariant = computed(() => {
  const status = props.metadata.status?.toLowerCase()
  if (!status) return 'secondary'
  if (status.includes('complete') || status.includes('done')) return 'default'
  if (status.includes('progress') || status.includes('active')) return 'default'
  if (status.includes('draft')) return 'secondary'
  if (status.includes('blocked') || status.includes('paused')) return 'destructive'
  return 'secondary'
})

// Check if there's any metadata to display
const hasMetadata = computed(() => {
  return props.metadata.author ||
    props.metadata.date ||
    props.metadata.status ||
    props.metadata.shortcutStory
})
</script>

<template>
  <div v-if="hasMetadata" class="flex flex-wrap items-center gap-3 text-sm">
    <!-- Author -->
    <div v-if="metadata.author" class="flex items-center gap-1.5 text-muted-foreground">
      <User class="size-3.5" />
      <span>{{ metadata.author }}</span>
    </div>

    <!-- Date -->
    <div v-if="metadata.date" class="flex items-center gap-1.5 text-muted-foreground">
      <Calendar class="size-3.5" />
      <span>{{ metadata.date }}</span>
    </div>

    <!-- Status -->
    <Badge v-if="metadata.status" :variant="statusVariant" class="gap-1">
      <CircleDot class="size-3" />
      {{ metadata.status }}
    </Badge>

    <!-- Shortcut Story Link -->
    <a
      v-if="metadata.shortcutStory && metadata.shortcutUrl"
      :href="metadata.shortcutUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 text-primary hover:underline"
    >
      <ExternalLink class="size-3.5" />
      <span>{{ metadata.shortcutStory }}</span>
    </a>
    <span
      v-else-if="metadata.shortcutStory"
      class="flex items-center gap-1.5 text-muted-foreground"
    >
      <ExternalLink class="size-3.5" />
      <span>{{ metadata.shortcutStory }}</span>
    </span>
  </div>
</template>
