<script setup lang="ts">
import { Toaster } from 'vue-sonner'
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly>
    <Toaster position="bottom-right" :theme="$colorMode.value as 'light' | 'dark'" rich-colors />
  </ClientOnly>
</template>
