import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASS_COLOR_SLOTS, classColorVar } from './classColor'

const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

/** The body of the first `{ ... }` block that follows `opener` (no nested braces expected). */
const blockAfter = (opener: RegExp): string => {
  const match = opener.exec(css)
  if (!match) throw new Error(`block not found: ${opener}`)
  const start = css.indexOf('{', match.index + match[0].length - 1)
  return css.slice(start + 1, css.indexOf('}', start))
}

const lightRoot = blockAfter(/^:root\s*\{/m)
const darkRoot = blockAfter(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/)

const tokens = [...Array.from({ length: 8 }, (_, index) => `--series-${index + 1}`), '--series-other']

describe('classColorVar', () => {
  it('maps slots 0-7 to --series-1..8', () => {
    expect(CLASS_COLOR_SLOTS).toBe(8)
    for (let slot = 0; slot < 8; slot += 1) expect(classColorVar(slot)).toBe(`var(--series-${slot + 1})`)
  })

  it('maps everything else to --series-other', () => {
    for (const slot of [8, 9, 31, 1_000, -1, -100]) expect(classColorVar(slot)).toBe('var(--series-other)')
  })
})

describe('styles.css series tokens', () => {
  it.each(tokens)('defines %s in the light :root block', (token) => {
    expect(lightRoot).toMatch(new RegExp(`${token}:\\s*#[0-9a-fA-F]{3,8}\\s*;`))
  })

  it.each(tokens)('defines %s in the dark prefers-color-scheme block', (token) => {
    expect(darkRoot).toMatch(new RegExp(`${token}:\\s*#[0-9a-fA-F]{3,8}\\s*;`))
  })

  it('every var(--series-*) used by classColorVar resolves to a defined token', () => {
    for (let slot = -1; slot <= 9; slot += 1) {
      const name = /var\((--[a-z0-9-]+)\)/.exec(classColorVar(slot))?.[1]
      expect(tokens).toContain(name)
    }
  })
})
