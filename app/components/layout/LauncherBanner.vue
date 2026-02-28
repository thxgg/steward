<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-vue-next'

const {
  hostMode,
  hostContext,
  unavailableCapabilities,
  warnings,
  launcherState
} = useHostRuntime()

const showBanner = computed(() => hostMode.value === 'launcher')

const hasDegradedServices = computed(() => {
  return unavailableCapabilities.value.length > 0 || warnings.value.length > 0
})

const contextLabel = computed(() => {
  const context = hostContext.value
  if (!context) {
    return 'Launcher context is unavailable in this runtime.'
  }

  if (!context.prdSlug) {
    return `Workspace ${context.repoName} is active with no auto-selected PRD.`
  }

  return `Workspace ${context.repoName} is active at PRD ${context.prdSlug}.`
})
</script>

<template>
  <section
    v-if="showBanner"
    class="border-b border-border/70 bg-muted/35 px-4 py-3 md:px-6"
    role="status"
    aria-live="polite"
  >
    <div class="mx-auto flex max-w-6xl flex-col gap-3">
      <div class="flex items-start gap-2 text-sm">
        <AlertTriangle v-if="hasDegradedServices" class="mt-0.5 size-4 shrink-0 text-amber-600" />
        <CheckCircle2 v-else class="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div class="space-y-1">
          <p class="font-medium">Desktop launcher mode</p>
          <p class="text-muted-foreground">{{ contextLabel }}</p>
        </div>
      </div>

      <div v-if="unavailableCapabilities.length > 0" class="space-y-1.5">
        <p class="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Wrench class="size-3.5" />
          Native services pending
        </p>
        <ul class="space-y-1 text-xs text-muted-foreground">
          <li v-for="capability in unavailableCapabilities" :key="capability.id">
            {{ capability.label }}: {{ capability.detail }}
            <span v-if="capability.action"> Action: {{ capability.action }}</span>
          </li>
        </ul>
      </div>

      <div v-if="warnings.length > 0" class="space-y-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Launcher warnings</p>
        <ul class="space-y-1 text-xs text-muted-foreground">
          <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <div v-if="launcherState?.contract.host.length || launcherState?.contract.ui.length" class="text-xs text-muted-foreground">
        Host contract: {{ launcherState?.contract.host.length || 0 }} host responsibilities,
        {{ launcherState?.contract.ui.length || 0 }} UI responsibilities.
      </div>
    </div>
  </section>
</template>
