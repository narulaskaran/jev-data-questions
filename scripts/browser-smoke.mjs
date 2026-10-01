import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:4173'
const artifactDir = process.env.SMOKE_ARTIFACT_DIR ?? 'artifacts/browser'
await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, reducedMotion: 'reduce', acceptDownloads: true })
      const page = await context.newPage()
      const crashes = []
      const paidRequests = []
      const apiRequests = []
      page.on('pageerror', (error) => crashes.push(error.message))
      // The static build must work without a deployed backend or paid provider.
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        apiRequests.push(path)
        if (route.request().method() === 'POST') paidRequests.push(path)
        await route.fulfill({ status: path.endsWith('/status') ? 200 : 404, contentType: 'application/json', body: JSON.stringify(path.endsWith('/status') ? { convex: false, uploadThing: false, sampleAvailable: true } : { error: 'ANALYSIS_NOT_FOUND', message: 'This saved analysis could not be found.' }) })
      })
      await page.route('**/_vercel/**', (route) => route.fulfill({ status: 200, body: '' }))
      const check = async (name) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page overflow at ${width}px`)
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        assert.deepEqual(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map((node) => node.target) })), [], `${name}: accessibility violations`)
        assert.deepEqual(crashes, [], `${name}: browser crashes`)
        results.push({ page: name, colorScheme, width, accessibilityViolations: 0, pageOverflow: false })
      }
      await page.goto(baseUrl)
      await page.getByText('Uploads are unavailable', { exact: false }).waitFor()
      await check('landing')
      if (width !== 320) await page.screenshot({ path: `${artifactDir}/landing-${colorScheme}-${width}.png`, fullPage: true })
      for (const demo of ['squirrels', 'football']) {
        apiRequests.length = 0
        await page.goto(`${baseUrl}/demo/${demo}`)
        await page.getByRole('heading', { name: demo === 'squirrels' ? 'Small creatures. Big picture.' : 'Every play tells a story.' }).waitFor()
        assert.equal(await page.locator('.dashboard-tile').count(), 2)
        assert.equal(await page.getByRole('button', { name: /Download results CSV/ }).count(), 2)
        await check(`demo-${demo}`)
        assert.deepEqual(apiRequests, [], 'Demo navigation must be fully local')
        if (width !== 320) await page.screenshot({ path: `${artifactDir}/${demo}-${colorScheme}-${width}.png`, fullPage: true })
        const downloadPromise = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Download results CSV', exact: true }).click()
        const download = await downloadPromise
        assert.match(download.suggestedFilename(), /\.csv$/)
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
        await page.getByRole('button', { name: 'Copy shareable public URL', exact: true }).click()
        assert.equal(await page.getByLabel('Copy this public link').inputValue(), `${baseUrl}/demo/${demo}`)
        await page.getByRole('button', { name: /Copy shareable public URL for/ }).click()
        assert.equal(await page.getByLabel('Copy this public link').inputValue(), `${baseUrl}/demo/${demo}`)
      }
      apiRequests.length = 0
      await page.getByRole('button', { name: 'Replay timeline' }).click()
      const slider = page.getByRole('slider', { name: 'Chart playhead' })
      await slider.waitFor()
      await slider.fill('0')
      await slider.press('ArrowRight')
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await check('saved-demo-replay')
      assert.deepEqual(apiRequests, [], 'Saved demo replay must be fully local')
      await page.goto(`${baseUrl}/share/missing`)
      await page.getByRole('alert').waitFor()
      await check('missing-share')
      assert.deepEqual(paidRequests, [], 'Visiting, replaying, exporting or sharing must never start paid work')
      await context.close()
    }
  }
  console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2))
} finally {
  await browser.close()
}
