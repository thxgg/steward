<script setup lang="ts">
import { FileText, Settings, Moon, Sun, LayoutGrid, Folder, Check } from 'lucide-vue-next'
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

const router = useRouter()
const { prds } = usePrd()
const { repos, currentRepoId, selectRepo } = useRepos()

function navigateToPrd(slug: string) {
  if (!currentRepoId.value) return
  router.push(`/${currentRepoId.value}/${slug}`)
  open.value = false
}

function switchRepo(repoId: string) {
  selectRepo(repoId)
  open.value = false
}
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput placeholder="Type a command or search..." />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>

      <CommandGroup v-if="prds?.length" heading="Documents">
        <CommandItem
          v-for="prd in prds"
          :key="prd.slug"
          :value="`prd-${prd.slug} ${prd.name}`"
          @select="navigateToPrd(prd.slug)"
        >
          <FileText class="size-4" />
          <span>{{ prd.name }}</span>
        </CommandItem>
      </CommandGroup>

      <CommandSeparator v-if="prds?.length && repos?.length" />

      <CommandGroup v-if="repos?.length" heading="Repositories">
        <CommandItem
          v-for="repo in repos"
          :key="repo.id"
          :value="`repo-${repo.id} ${repo.name}`"
          @select="switchRepo(repo.id)"
        >
          <Folder class="size-4" />
          <span class="flex-1">{{ repo.name }}</span>
          <Check v-if="repo.id === currentRepoId" class="size-4 text-primary" />
        </CommandItem>
      </CommandGroup>

      <CommandSeparator v-if="repos?.length" />

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
