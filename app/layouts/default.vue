<script setup lang="ts">
import { Button } from '~/components/ui/button'

const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Fixed Header -->
    <header
      class="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
    >
      <div class="flex h-full items-center justify-between px-4 md:px-6">
        <!-- App Title -->
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold tracking-tight">
            PRD Viewer
          </h1>
        </div>

        <!-- Right side: Repo Selector + Theme Toggle (ClientOnly to prevent hydration mismatch) -->
        <ClientOnly>
          <div class="flex items-center gap-3">
            <LayoutRepoSelector />
            <Button
              variant="ghost"
              size="icon"
              class="size-9"
              @click="toggleColorMode"
            >
              <svg
                v-if="colorMode.value === 'dark'"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="size-4"
              >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              <span class="sr-only">Toggle theme</span>
            </Button>
          </div>
          <template #fallback>
            <div class="flex items-center gap-3">
              <div class="h-8 w-[200px] animate-pulse rounded-md bg-muted" />
              <div class="size-9 animate-pulse rounded-md bg-muted" />
            </div>
          </template>
        </ClientOnly>
      </div>
    </header>

    <!-- Main Content Area with top padding for fixed header -->
    <div class="flex h-screen pt-14">
      <!-- Sidebar -->
      <ClientOnly>
        <LayoutSidebar />
        <template #fallback>
          <aside class="flex h-full w-64 flex-col border-r border-border bg-background">
            <div class="flex h-12 items-center border-b border-border px-4">
              <div class="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div class="flex-1 p-2 space-y-2">
              <div class="h-9 animate-pulse rounded-md bg-muted" />
              <div class="h-9 animate-pulse rounded-md bg-muted" />
              <div class="h-9 animate-pulse rounded-md bg-muted" />
            </div>
          </aside>
        </template>
      </ClientOnly>

      <!-- Main content -->
      <main class="flex-1 overflow-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
