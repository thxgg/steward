<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="p-8">
      <h1 class="text-3xl font-bold mb-4">PRD Viewer</h1>
      <p class="text-muted-foreground mb-4">Tailwind CSS v4 + shadcn-vue is working!</p>
      <button
        class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
        @click="toggleColorMode"
      >
        Toggle {{ $colorMode.value === 'dark' ? 'Light' : 'Dark' }} Mode
      </button>
      <p class="mt-4 text-sm text-muted-foreground">Current mode: {{ $colorMode.value }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>
