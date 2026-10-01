// Screenshot routes of a running app for visual review. No API calls leave the page.
//
//   . .local/browser/env.sh                 # once per shell (see scripts/browser-setup.sh)
//   npm run dev                             # in another terminal
//   node scripts/shoot.mjs                  # default routes, 1440 + 390 px, light + dark
//   node scripts/shoot.mjs /demo/squirrels --widths 320 --schemes dark --out /tmp/shots
//
// Options: --base URL (default $SMOKE_BASE_URL or http://127.0.0.1:5173), --out DIR
// (default .local/shots), --widths a,b, --schemes light,dark. Positional args are paths.
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const [, value] = args.splice(index, 2)
  return value
}
const base = option('base', process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '')
const out = option('out', '.local/shots')
const widths = option('widths', '1440,390').split(',').map(Number)
const schemes = option('schemes', 'light,dark').split(',')
const paths = args.length ? args : ['/', '/demo/squirrels', '/demo/football', '/share/demo-football']

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const colorScheme of schemes) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme })
    const page = await context.newPage()
    // Same stub as the browser smoke suite: the live backend is off.
    await page.route('**/api/**', (route) => {
      const status = route.request().url().endsWith('/status')
      return route.fulfill({
        status: status ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(status ? { convex: false, uploadThing: false, sampleAvailable: true } : { error: 'ANALYSIS_NOT_FOUND' }),
      })
    })
    await page.route('**/_vercel/**', (route) => route.fulfill({ status: 200, body: '' }))
    for (const path of paths) {
      await page.goto(base + path)
      await page.waitForTimeout(900)
      const name = path.replace(/^\/|\/$/g, '').replace(/\W+/g, '-') || 'landing'
      const file = `${out}/${name}-${colorScheme}-${width}.png`
      await page.screenshot({ path: file, fullPage: true })
      console.log(file)
    }
    await context.close()
  }
}
await browser.close()
