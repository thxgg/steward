import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

function resolvePackageMetadata(): { name: string; version: string } {
  try {
    const packageJsonPath = resolve(process.cwd(), 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      name?: unknown
      version?: unknown
    }

    const name = typeof packageJson.name === 'string' && packageJson.name.trim().length > 0
      ? packageJson.name.trim()
      : 'steward'

    const version = typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
      ? packageJson.version.trim()
      : '0.0.0'

    return { name, version }
  } catch {
    return {
      name: 'steward',
      version: '0.0.0'
    }
  }
}

const packageMetadata = resolvePackageMetadata()

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
  runtimeConfig: {
    public: {
      stewardVersion: packageMetadata.version,
      stewardPackageName: packageMetadata.name
    }
  },
  vite: {
    plugins: [tailwindcss()]
  },
  // Enable SPA fallback for dynamic routes
  routeRules: {
    '/**': { ssr: false }
  }
})
