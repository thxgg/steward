<script setup lang="ts">
import {
  ClipboardCopy,
  Loader2,
  Plug,
  PlugZap,
  Send,
  Terminal,
  Unplug
} from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

const { capabilities } = useHostRuntime()
const {
  terminal,
  outputEvents,
  draftInput,
  runtime,
  isLauncherMode,
  isAttached,
  attach,
  detach,
  sendInput,
  resize
} = useLauncherTerminal()

const rowsDraft = ref(terminal.value.rows)
const colsDraft = ref(terminal.value.cols)
const copiedAt = ref<string | null>(null)
const outputContainer = ref<HTMLElement | null>(null)

const terminalCapability = computed(() => {
  return capabilities.value.find((capability) => capability.id === 'terminalEmbedding') || null
})

const noRendererFallback = computed(() => {
  const capability = terminalCapability.value
  return !!capability && !capability.available
})

const renderedOutput = computed(() => {
  return outputEvents.value
    .map((event) => {
      const channelPrefix = event.channel === 'stderr'
        ? '[stderr] '
        : event.channel === 'system'
          ? '[system] '
          : ''

      return `${channelPrefix}${event.text}`
    })
    .join('\n')
})

const runtimeErrorMessage = computed(() => {
  if (!runtime.value.lastError) {
    return null
  }

  return `${runtime.value.lastError.kind} (${runtime.value.lastError.code}): ${runtime.value.lastError.message}`
})

watch(
  () => [terminal.value.rows, terminal.value.cols] as const,
  ([rows, cols]) => {
    rowsDraft.value = rows
    colsDraft.value = cols
  },
  { immediate: true }
)

watch(
  () => outputEvents.value.length,
  async () => {
    await nextTick()

    const container = outputContainer.value
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }
)

async function handleAttachToggle() {
  if (isAttached.value) {
    await detach('manual detach')
    return
  }

  await attach(rowsDraft.value, colsDraft.value)
}

async function handleResize() {
  await resize(rowsDraft.value, colsDraft.value)
}

async function handleSendInput() {
  await sendInput()
}

async function handleCopyOutput() {
  if (!import.meta.client) {
    return
  }

  try {
    await navigator.clipboard.writeText(renderedOutput.value)
    copiedAt.value = new Date().toISOString()
  } catch {
    copiedAt.value = null
  }
}
</script>

<template>
  <section
    v-if="isLauncherMode"
    class="border-t border-border/70 bg-background px-4 py-3 md:px-6"
  >
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="inline-flex items-center gap-2 text-sm">
          <Terminal class="size-4" />
          <span class="font-medium">libghostty Terminal</span>
          <span class="text-xs text-muted-foreground">{{ terminal.state }}</span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="runtime.connecting || noRendererFallback"
            @click="handleAttachToggle"
          >
            <Loader2 v-if="runtime.connecting" class="mr-1.5 size-3.5 animate-spin" />
            <Unplug v-else-if="isAttached" class="mr-1.5 size-3.5" />
            <Plug v-else class="mr-1.5 size-3.5" />
            {{ isAttached ? 'Detach' : 'Attach' }}
          </Button>

          <Button
            variant="outline"
            size="sm"
            :disabled="runtime.resizing || noRendererFallback"
            @click="handleResize"
          >
            <Loader2 v-if="runtime.resizing" class="mr-1.5 size-3.5 animate-spin" />
            <PlugZap v-else class="mr-1.5 size-3.5" />
            Resize
          </Button>

          <Button
            variant="ghost"
            size="sm"
            :disabled="renderedOutput.length === 0"
            @click="handleCopyOutput"
          >
            <ClipboardCopy class="mr-1.5 size-3.5" />
            {{ copiedAt ? 'Copied' : 'Copy Output' }}
          </Button>
        </div>
      </div>

      <p v-if="terminal.sessionId" class="text-xs text-muted-foreground">
        Session: {{ terminal.sessionId }} | Size: {{ terminal.rows }}x{{ terminal.cols }} | Scrollback: {{ terminal.scrollbackLimit }} lines
      </p>

      <p class="text-xs text-muted-foreground">{{ terminal.message }}</p>

      <p v-if="runtimeErrorMessage" class="text-xs text-destructive">{{ runtimeErrorMessage }}</p>

      <p
        v-if="noRendererFallback"
        class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700"
      >
        libghostty is the strict terminal renderer in launcher mode. No fallback terminal will be used.
        <span v-if="terminalCapability?.action"> {{ terminalCapability.action }}</span>
      </p>

      <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          v-model.number="rowsDraft"
          type="number"
          min="10"
          max="120"
          :disabled="runtime.resizing || noRendererFallback"
          placeholder="Rows"
        />
        <Input
          v-model.number="colsDraft"
          type="number"
          min="20"
          max="300"
          :disabled="runtime.resizing || noRendererFallback"
          placeholder="Cols"
        />
        <Button
          variant="secondary"
          size="sm"
          :disabled="runtime.resizing || noRendererFallback"
          @click="handleResize"
        >
          Apply Size
        </Button>
      </div>

      <div
        ref="outputContainer"
        class="max-h-64 overflow-auto rounded-md border border-border bg-muted/25 p-3 font-mono text-xs leading-relaxed"
      >
        <pre class="whitespace-pre-wrap break-words">{{ renderedOutput || '[terminal output appears here]' }}</pre>
      </div>

      <div class="flex items-center gap-2">
        <Input
          v-model="draftInput"
          :disabled="runtime.sending || !isAttached || noRendererFallback"
          placeholder="Type terminal input and press Enter"
          class="font-mono"
          @keydown.enter.prevent="handleSendInput"
        />
        <Button
          size="sm"
          :disabled="runtime.sending || !isAttached || noRendererFallback"
          @click="handleSendInput"
        >
          <Loader2 v-if="runtime.sending" class="mr-1.5 size-3.5 animate-spin" />
          <Send v-else class="mr-1.5 size-3.5" />
          Send
        </Button>
      </div>

      <p class="text-[11px] text-muted-foreground">
        Baseline: input/output, prompt commands, copy/paste, resize, scrollback, and attach/detach lifecycle hooks.
      </p>
    </div>
  </section>
</template>
