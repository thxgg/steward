<script setup lang="ts">
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  RotateCcw,
  Wrench
} from 'lucide-vue-next'
import { Button } from '~/components/ui/button'

const { hostContext, launcherState } = useHostRuntime()
const {
  status,
  connection,
  lastError,
  isLauncherMode,
  isActionInFlight,
  refreshStatus,
  runAction
} = useEngineLifecycle()

const hasDegradedServices = computed(() => {
  const capabilities = launcherState.value?.capabilities || []
  const hasUnavailable = capabilities.some((capability) => !capability.available)
  return hasUnavailable || !!lastError.value || status.value.state === 'degraded'
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

const engineLabel = computed(() => {
  const mode = status.value.reused ? 'reused endpoint' : (status.value.owned ? 'managed process' : 'unmanaged')
  const endpoint = status.value.endpoint ? ` at ${status.value.endpoint}` : ''

  return `${status.value.state} (${mode}, connection=${status.value.connectionMode})${endpoint}`
})

const engineIdentityLabel = computed(() => {
  if (!status.value.instanceKey) {
    return 'Engine identity: unavailable'
  }

  return `Engine identity: ${status.value.instanceKey}`
})

const sessionLabel = computed(() => {
  const session = launcherState.value?.session
  if (!session) {
    return 'Session bridge: unavailable'
  }

  const active = session.activeSessionId
    ? `active=${session.activeSessionId}`
    : 'active=<none>'

  return `Session bridge: ${session.state} (${active}, source=${session.source})`
})

const errorLabel = computed(() => {
  if (!lastError.value) {
    return null
  }

  const prefixes: Record<string, string> = {
    process: 'Process error',
    auth: 'Auth error',
    network: 'Network error'
  }

  const prefix = prefixes[lastError.value.kind] || 'Launcher error'
  return `${prefix} (${lastError.value.code}): ${lastError.value.message}`
})

async function handleRetry() {
  await runAction('retry')
}

async function handleReconnect() {
  await runAction('reconnect')
}

async function handleRestart() {
  await runAction('restart')
}
</script>

<template>
  <section
    v-if="isLauncherMode"
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

      <p class="text-xs text-muted-foreground">
        OpenCode engine: {{ engineLabel }}. {{ status.message }}
      </p>

      <p class="text-xs text-muted-foreground">{{ engineIdentityLabel }}</p>

      <p class="text-xs text-muted-foreground">{{ sessionLabel }}</p>

      <p class="text-xs text-muted-foreground">
        Connection: {{ connection.state }}
        <span v-if="connection.lastSyncedAt">(last sync {{ connection.lastSyncedAt }})</span>
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="isActionInFlight"
          @click="handleRetry"
        >
          <Loader2 v-if="connection.inFlightAction === 'retry'" class="mr-1.5 size-3.5 animate-spin" />
          <RefreshCw v-else class="mr-1.5 size-3.5" />
          Retry
        </Button>

        <Button
          size="sm"
          variant="outline"
          :disabled="isActionInFlight"
          @click="handleReconnect"
        >
          <Loader2 v-if="connection.inFlightAction === 'reconnect'" class="mr-1.5 size-3.5 animate-spin" />
          <Plug v-else class="mr-1.5 size-3.5" />
          Reconnect
        </Button>

        <Button
          size="sm"
          variant="outline"
          :disabled="isActionInFlight"
          @click="handleRestart"
        >
          <Loader2 v-if="connection.inFlightAction === 'restart'" class="mr-1.5 size-3.5 animate-spin" />
          <RotateCcw v-else class="mr-1.5 size-3.5" />
          Restart
        </Button>

        <Button
          size="sm"
          variant="ghost"
          :disabled="isActionInFlight"
          @click="refreshStatus"
        >
          <RefreshCw class="mr-1.5 size-3.5" />
          Refresh status
        </Button>
      </div>

      <p v-if="errorLabel" class="text-xs text-destructive">{{ errorLabel }}</p>

      <div v-if="status.diagnostics.length > 0" class="space-y-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Engine diagnostics</p>
        <ul class="space-y-1 text-xs text-muted-foreground">
          <li v-for="diagnostic in status.diagnostics" :key="diagnostic">{{ diagnostic }}</li>
        </ul>
      </div>

      <div v-if="launcherState?.capabilities.some((capability) => !capability.available)" class="space-y-1.5">
        <p class="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Wrench class="size-3.5" />
          Native services pending
        </p>
        <ul class="space-y-1 text-xs text-muted-foreground">
          <li
            v-for="capability in launcherState?.capabilities.filter((entry) => !entry.available)"
            :key="capability.id"
          >
            {{ capability.label }}: {{ capability.detail }}
            <span v-if="capability.action"> Action: {{ capability.action }}</span>
          </li>
        </ul>
      </div>

      <div v-if="launcherState?.contract.host.length || launcherState?.contract.ui.length" class="text-xs text-muted-foreground">
        Host contract: {{ launcherState?.contract.host.length || 0 }} host responsibilities,
        {{ launcherState?.contract.ui.length || 0 }} UI responsibilities.
      </div>
    </div>
  </section>
</template>
