// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const entry = path.join(root, 'src/main.tsx')
const serverDir = path.join(root, 'src/server') + path.sep

const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const IMPORT_PATTERNS = [
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Resolve a relative specifier the way Vite would, including the repo's `.js`-suffixed TypeScript imports. */
const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = path.resolve(path.dirname(from), specifier)
  const stem = base.replace(/\.(?:js|jsx|mjs)$/, '')
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => stem + extension),
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]
  return candidates.find((candidate) => SOURCE_EXTENSIONS.includes(path.extname(candidate)) && existsSync(candidate))
}

const specifiersOf = (source: string): string[] => IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))

interface Graph {
  files: string[]
  bare: { file: string; specifier: string }[]
  unresolved: { file: string; specifier: string }[]
}

const walk = (): Graph => {
  const seen = new Set<string>()
  const queue = [entry]
  const bare: Graph['bare'] = []
  const unresolved: Graph['unresolved'] = []
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) { bare.push({ file, specifier }); continue }
      if (/\.(?:css|json|svg|png|woff2?)$/.test(specifier)) continue
      const resolved = resolveRelative(file, specifier)
      if (resolved) queue.push(resolved)
      else unresolved.push({ file, specifier })
    }
  }
  return { files: [...seen].sort(), bare, unresolved }
}

const graph = walk()
const relative = (file: string) => path.relative(root, file)
const hasFile = (name: string) => graph.files.some((file) => file.endsWith(path.sep + name))

const FORBIDDEN_STRINGS = ['JEV_API_KEY', 'OPENROUTER_KEY', 'CONVEX_WRITE_SECRET', 'api.typesafe.ai', 'openrouter.ai']

describe('browser/server boundary', () => {
  it('walks a non-trivial browser import graph from src/main.tsx', () => {
    expect(existsSync(entry)).toBe(true)
    expect(graph.files.length).toBeGreaterThan(20)
    expect(hasFile('App.tsx')).toBe(true)
    expect(hasFile('RunPage.tsx')).toBe(true)
    expect(hasFile('parseCsv.ts')).toBe(true)
    expect(hasFile('useAnalysisFeed.ts')).toBe(true)
  })

  it('resolves every relative import in the graph', () => {
    expect(graph.unresolved.map((item) => `${relative(item.file)} -> ${item.specifier}`)).toEqual([])
  })

  it('never reaches a file under src/server/', () => {
    expect(graph.files.filter((file) => file.startsWith(serverDir)).map(relative)).toEqual([])
  })

  it('never imports node built-ins, convex, the Jev SDK or @vercel/functions', () => {
    const forbidden = graph.bare.filter(({ specifier }) => (
      specifier.startsWith('node:')
      || specifier === 'convex' || specifier.startsWith('convex/')
      || specifier === '@typesafe-ai/sdk' || specifier.startsWith('@typesafe-ai/sdk/')
      || specifier === '@vercel/functions' || specifier.startsWith('@vercel/functions/')
    ))
    expect(forbidden.map((item) => `${relative(item.file)} -> ${item.specifier}`)).toEqual([])
  })

  it('only imports packages that are browser dependencies', () => {
    const allowed = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@fontsource-variable/inter'])
    const unexpected = graph.bare.filter(({ specifier }) => !allowed.has(specifier) && !specifier.startsWith('@fontsource/'))
    expect(unexpected.map((item) => `${relative(item.file)} -> ${item.specifier}`)).toEqual([])
  })

  it.each(FORBIDDEN_STRINGS)('no browser file contains %s', (text) => {
    const offenders = graph.files.filter((file) => readFileSync(file, 'utf8').includes(text)).map(relative)
    expect(offenders).toEqual([])
  })
})
