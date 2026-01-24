<script setup lang="ts">
import type { ComboboxContentEmits, ComboboxContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxContent, ComboboxPortal, useForwardPropsEmits } from "reka-ui"
import { cn } from "@/lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<ComboboxContentProps & { class?: HTMLAttributes["class"] }>(), {
  position: "popper",
  align: "start",
  side: "bottom",
  sideOffset: 4,
  avoidCollisions: false,
})
const emits = defineEmits<ComboboxContentEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ComboboxContent
    data-slot="combobox-list"
    v-bind="{ ...$attrs, ...forwarded }"
    :class="cn('z-[9999] w-[200px] rounded-md border bg-popover text-popover-foreground overflow-hidden shadow-md outline-none', props.class)"
  >
    <slot />
  </ComboboxContent>
</template>
