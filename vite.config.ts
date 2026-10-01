import { existsSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const SERVER_ONLY_MARKERS = ['@typesafe-ai/sdk', 'JEV_API_KEY', 'OPENROUTER_KEY', 'CONVEX_WRITE_SECRET', 'https://api.typesafe.ai', 'https://openrouter.ai', 'convex/browser', 'CONVEX_URL', 'node:crypto'] as const

/** Fails the build if anything server-only reaches a browser chunk. */
const browserServerBoundaryGuard = (): Plugin => ({
  name: 'browser-server-boundary-guard',
  generateBundle(_options, bundle) {
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue
      for (const marker of SERVER_ONLY_MARKERS) {
        if (output.code.includes(marker)) this.error(`Server-only marker ${marker} reached browser chunk ${fileName}`)
      }
    }
  },
})

interface ApiRoute {
  file: string
  pattern: RegExp
  params: string[]
  dynamic: boolean
}

const collectRoutes = (root: string, dir = root): ApiRoute[] => {
  if (!existsSync(dir)) return []
  const routes: ApiRoute[] = []
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry)
    if (statSync(file).isDirectory()) { routes.push(...collectRoutes(root, file)); continue }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    const segments = path.relative(root, file).replace(/\.ts$/, '').split(path.sep)
    const params: string[] = []
    const source = segments.map((segment) => {
      const match = segment.match(/^\[(.+)\]$/)
      if (!match) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      params.push(match[1])
      return '([^/]+)'
    }).join('/')
    routes.push({ file, pattern: new RegExp(`^/api/${source}/?$`), params, dynamic: params.length > 0 })
  }
  // Static files win over dynamic segments, as on Vercel.
  return routes.sort((left, right) => Number(left.dynamic) - Number(right.dynamic))
}

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return undefined
  const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'application/json') {
    try { return JSON.parse(raw.toString('utf8')) } catch { return raw.toString('utf8') }
  }
  if (type === 'text/plain') return raw.toString('utf8')
  return raw
}

/**
 * Serves `api/*.ts` during `vite dev` the way Vercel's Node runtime does, so the
 * product runs end to end locally. With no provider keys it uses process-local
 * storage and clearly labelled simulated providers.
 */
const localApi = (): Plugin => ({
  name: 'local-api',
  apply: 'serve',
  configureServer(server: ViteDevServer) {
    process.env.JEV_PLAYGROUND_STORAGE ??= 'local'
    process.env.JEV_PLAYGROUND_MOCK ??= '1'
    process.env.JEV_CHUNK_BUDGET_MS ??= '4000'
    const apiRoot = path.resolve(server.config.root, 'api')
    server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith('/api/')) { next(); return }
      const json = (status: number, body: unknown) => {
        response.statusCode = status
        if (!response.hasHeader('Content-Type')) response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(body))
      }
      for (const route of collectRoutes(apiRoot)) {
        const match = url.pathname.match(route.pattern)
        if (!match) continue
        try {
          const query: Record<string, string> = Object.fromEntries(url.searchParams)
          route.params.forEach((name, index) => { query[name] = decodeURIComponent(match[index + 1]) })
          const module = await server.ssrLoadModule(route.file)
          const facade = {
            status(code: number) { response.statusCode = code; return facade },
            setHeader(name: string, value: string) { response.setHeader(name, value); return facade },
            json(body: unknown) { json(response.statusCode, body); return facade },
          }
          await module.default({ method: request.method, headers: request.headers, query, body: await readBody(request) }, facade)
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          console.error('[local-api]', error)
          if (!response.writableEnded) json(500, { error: 'INTERNAL_ERROR', message: 'Local API handler crashed. See the dev server log.' })
        }
        return
      }
      json(404, { error: 'NOT_FOUND', message: 'No such API route.' })
    })
  },
})

/**
 * Link previews need absolute image URLs. Vercel exposes the production
 * hostname at build time; `JEV_PUBLIC_ORIGIN` overrides it for other hosts.
 */
const absoluteSocialUrls = (): Plugin => ({
  name: 'absolute-social-urls',
  transformIndexHtml(html) {
    const explicit = process.env.JEV_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '')
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    const origin = explicit || (host ? `https://${host}` : '')
    if (!origin) return html
    return html
      .replace('content="/og.png"', `content="${origin}/og.png"`)
      .replace('<meta property="og:type"', `<meta property="og:url" content="${origin}/" />\n    <meta property="og:type"`)
  },
})

export default defineConfig({
  plugins: [react(), localApi(), absoluteSocialUrls(), browserServerBoundaryGuard()],
})
