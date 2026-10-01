import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:4173'
const artifactDir = process.env.SMOKE_ARTIFACT_DIR ?? 'artifacts/browser'
await mkdir(artifactDir, { recursive: true })
// A small table with a date, a category, a quantity, and a yes/no column.
const uploadPath = path.join(await mkdtemp(path.join(tmpdir(), 'jev-smoke-')), 'shop orders.csv')
await writeFile(uploadPath, ['order_date,region,units,gift', ...Array.from({ length: 96 }, (_, index) => (
  `2025-${String(Math.floor(index / 8) + 1).padStart(2, '0')}-${String((index % 8) * 3 + 1).padStart(2, '0')},${['West', 'East', 'North'][index % 3]},${5 + Math.floor(index / 8) * 2 + (index % 3 === 0 ? 9 : 0)},${index % 3 === 0 && index % 2 === 0}`
))].join('\n'))
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
      await page.getByText('read in your browser and is not uploaded', { exact: false }).waitFor()
      await check('landing')
      if (width !== 320) await page.screenshot({ path: `${artifactDir}/landing-${colorScheme}-${width}.png`, fullPage: true })
      for (const demo of ['squirrels', 'football']) {
        apiRequests.length = 0
        await page.goto(`${baseUrl}/demo/${demo}`)
        await page.getByRole('heading', { name: demo === 'squirrels' ? 'Squirrel census' : 'Super Bowl LX: Seattle on offense' }).waitFor()
        await page.locator('.story-card').first().waitFor()
        const cards = await page.locator('.story-card').count()
        assert.ok(cards >= 4, `${demo}: expected a full dashboard, got ${cards} charts`)
        assert.equal(await page.getByRole('button', { name: /^Download CSV for/ }).count(), cards)
        assert.equal(await page.locator('.dashboard-tile').count(), 0, 'Demos show observed charts only')
        // Every chart must fit its card: no clipped plot at any width.
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.story-card svg')]
          .filter((svg) => svg.getBoundingClientRect().right > svg.closest('.story-card').getBoundingClientRect().right + 1)
          .map((svg) => svg.closest('.story-card').querySelector('h2').textContent)), [], `${demo}: chart wider than its card at ${width}px`)
        await check(`demo-${demo}`)
        assert.deepEqual(apiRequests, [], 'Demo navigation must be fully local')
        if (width !== 320) await page.screenshot({ path: `${artifactDir}/${demo}-${colorScheme}-${width}.png`, fullPage: true })
        const downloadPromise = page.waitForEvent('download')
        await page.getByRole('button', { name: /^Download CSV for/ }).first().click()
        const download = await downloadPromise
        assert.match(download.suggestedFilename(), /\.csv$/)
        await page.getByRole('button', { name: /^Show data table for/ }).first().click()
        await page.locator('.story-card table').first().waitFor()
        await check(`demo-${demo}-table`)
        await page.getByRole('button', { name: /^Show chart for/ }).first().click()
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
        await page.getByRole('button', { name: 'Copy a link to this dashboard' }).click()
        assert.equal(await page.getByLabel('Copy this public link').inputValue(), `${baseUrl}/demo/${demo}`)
      }
      // Asking about columns reorders the dashboard without any request.
      await page.goto(`${baseUrl}/demo/squirrels`)
      await page.getByLabel('Ask about your columns').fill('where are squirrels eating, by location')
      await page.getByRole('button', { name: 'Ask', exact: true }).click()
      await page.getByText('Leading with charts about:', { exact: false }).waitFor()
      assert.match(await page.locator('.story-card h2').first().innerText(), /^Eating is 1\.5× as common for Ground Plane/)
      await check('demo-squirrels-question')
      // A dropped file becomes a dashboard in the browser, with no backend.
      apiRequests.length = 0
      await page.goto(baseUrl)
      await page.setInputFiles('#csv-file', uploadPath)
      await page.locator('.story-card').first().waitFor()
      assert.equal(new URL(page.url()).pathname, '/local')
      assert.ok(await page.locator('.story-card').count() >= 3, 'Local upload should produce a dashboard')
      assert.match(await page.locator('.story-card h2').first().innerText(), /^Total units rose \d+%/)
      assert.equal(await page.getByRole('button', { name: /analyze dataset/i }).count(), 0)
      await check('local-upload')
      assert.deepEqual(apiRequests.filter((request) => !request.endsWith('/status')), [], 'A local upload must not be sent anywhere')
      if (width !== 320) await page.screenshot({ path: `${artifactDir}/upload-${colorScheme}-${width}.png`, fullPage: true })
      await page.goto(`${baseUrl}/demo/football`)
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
