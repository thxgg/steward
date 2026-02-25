<script setup lang="ts">
import { AlertTriangle, Database, Loader2 } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { Button } from '~/components/ui/button'

const { status, initialized, isBlocking, refreshStatus } = useStateMigration()
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const progressPercent = computed(() => Math.max(0, Math.min(100, status.value.percent)))

const progressWidth = computed(() => `${progressPercent.value}%`)

const progressLabel = computed(() => {
  const total = status.value.totalRows
  const processed = status.value.processedRows
  if (total <= 0) {
    return 'Preparing migration...'
  }

  return `${processed} of ${total} PRD states migrated`
})

const statusText = computed(() => {
  if (status.value.state === 'failed') {
    return status.value.errorMessage || 'Migration failed before completion.'
  }

  if (status.value.currentSlug) {
    return `Migrating ${status.value.currentSlug}`
  }

  return 'Preparing migration steps'
})

const shouldShow = computed(() => initialized.value && isBlocking.value)
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-[var(--ease-out-cubic)] motion-reduce:transition-none"
    enter-from-class="opacity-0 scale-[0.98]"
    leave-active-class="transition-all duration-200 ease-[var(--ease-out-cubic)] motion-reduce:transition-none"
    leave-to-class="opacity-0"
  >
    <div
      v-if="shouldShow"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-[radial-gradient(circle_at_18%_20%,oklch(0.92_0.03_218_/_0.65),transparent_52%),radial-gradient(circle_at_82%_80%,oklch(0.95_0.04_40_/_0.5),transparent_46%),oklch(0.17_0.02_240_/_0.72)] px-4 backdrop-blur-sm"
      role="alert"
      aria-live="assertive"
      aria-busy="true"
    >
      <div class="w-full max-w-xl rounded-2xl border border-border/70 bg-background/95 p-6 shadow-2xl md:p-7">
        <div class="mb-4 flex items-start gap-3">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60">
            <Loader2
              v-if="status.state === 'running'"
              class="size-5 text-primary"
              :class="prefersReducedMotion ? '' : 'animate-spin'"
            />
            <AlertTriangle v-else class="size-5 text-destructive" />
          </div>

          <div class="space-y-1">
            <p class="text-sm font-semibold uppercase tracking-[0.09em] text-muted-foreground">Data upgrade</p>
            <h2 class="text-xl font-semibold tracking-tight">
              {{ status.state === 'running' ? 'One-time migration in progress' : 'Migration needs attention' }}
            </h2>
            <p class="text-sm text-muted-foreground">
              Steward is upgrading legacy PRD progress data to the latest format. This runs once per local database.
            </p>
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-border/80 bg-card/70 p-4">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="inline-flex items-center gap-1.5 text-muted-foreground">
              <Database class="size-3.5" />
              {{ progressLabel }}
            </span>
            <span class="font-medium tabular-nums">{{ progressPercent }}%</span>
          </div>

          <div class="h-2 overflow-hidden rounded-full border border-border/70 bg-muted/60">
            <div
              class="migration-progress-fill h-full rounded-full motion-reduce:transition-none"
              :class="prefersReducedMotion ? '' : 'migration-progress-fill--animated'"
              :style="{ width: progressWidth }"
            />
          </div>

          <p class="text-sm text-muted-foreground">{{ statusText }}</p>
        </div>

        <div v-if="status.state === 'failed'" class="mt-4 flex items-center justify-end">
          <Button size="sm" variant="outline" @click="refreshStatus">
            Retry status check
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>
