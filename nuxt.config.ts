import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  future: {
    compatibilityVersion: 4
  },
  modules: [
    '@nuxtjs/color-mode'
  ],
  components: {
    dirs: [
      {
        path: '~/components',
        ignore: ['**/index.ts']
      }
    ]
  },
  css: ['~/assets/css/main.css'],
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'dark'
  },
  vite: {
    plugins: [tailwindcss()]
  },
  // Enable SPA fallback for dynamic routes
  routeRules: {
    '/**': { ssr: false }
  }
})
