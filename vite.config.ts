/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

const socialMetadata = (): Plugin => ({
  name: 'social-metadata',
  transformIndexHtml(html) {
    const deploymentUrl = process.env.PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    if (!deploymentUrl) return html
    const site = new URL(deploymentUrl)
    if (site.protocol !== 'https:' || site.username || site.password) throw new Error('PUBLIC_SITE_URL must be a public HTTPS URL without credentials')
    return html.replace(/content="\/social-card\.png"/g, () => `content="${site.origin}/social-card.png"`)
  },
})

const SERVER_ONLY_MARKERS = ['@typesafe-ai/sdk', 'JEV_API_KEY', 'OPENROUTER_KEY', 'UPLOADTHING_TOKEN', 'UPLOADTHING_SECRET', 'https://api.typesafe.ai', 'https://openrouter.ai', 'convex/browser', 'CONVEX_URL'] as const

const browserServerBoundaryGuard = (): Plugin => ({
  name: 'browser-server-boundary-guard',
  generateBundle(_options, bundle) {
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue
      for (const marker of SERVER_ONLY_MARKERS) {
        if (output.code.includes(marker)) {
          this.error(`Server-only marker ${marker} reached browser chunk ${fileName}`)
        }
      }
    }
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), browserServerBoundaryGuard(), socialMetadata()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
