<script setup lang="ts">
import { FileText, Settings, Moon, Sun, LayoutGrid } from 'lucide-vue-next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '~/components/ui/command'

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput placeholder="Type a command or search..." />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>

      <CommandGroup heading="Navigation">
        <CommandItem value="placeholder-prd-1">
          <FileText class="size-4" />
          <span>Example PRD 1</span>
        </CommandItem>
        <CommandItem value="placeholder-prd-2">
          <FileText class="size-4" />
          <span>Example PRD 2</span>
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />

      <CommandGroup heading="Actions">
        <CommandItem value="toggle-theme">
          <Sun class="size-4 dark:hidden" />
          <Moon class="hidden size-4 dark:block" />
          <span>Toggle theme</span>
        </CommandItem>
        <CommandItem value="switch-tab">
          <LayoutGrid class="size-4" />
          <span>Switch to Task Board</span>
        </CommandItem>
        <CommandItem value="settings">
          <Settings class="size-4" />
          <span>Open settings</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
