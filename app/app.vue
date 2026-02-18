<script setup lang="ts">
import { Toaster } from 'vue-sonner'

const { resolvedTheme } = useThemeMode()
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly>
    <Toaster position="bottom-right" :theme="resolvedTheme" rich-colors />
  </ClientOnly>
</template>
