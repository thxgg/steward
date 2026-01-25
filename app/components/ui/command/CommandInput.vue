<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Search } from "lucide-vue-next"
import { ListboxFilter, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"
import { useCommand } from "."
import { ref, onMounted, nextTick } from "vue"

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()

const inputRef = ref<{ $el?: HTMLInputElement } | null>(null)

// Position cursor at end instead of selecting all text
onMounted(() => {
  nextTick(() => {
    const input = inputRef.value?.$el
    if (input && filterState.search) {
      const len = filterState.search.length
      input.setSelectionRange(len, len)
    }
  })
})
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="flex h-9 items-center gap-2 border-b px-3"
  >
    <Search class="size-4 shrink-0 opacity-50" />
    <ListboxFilter
      ref="inputRef"
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      data-slot="command-input"
      auto-focus
      :class="cn('placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    />
  </div>
</template>
