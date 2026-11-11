import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { chromium, webkit } from '@playwright/test'
import { createServer } from 'vite'

let server, baseURL
const buildings = [
  { id: 'eng-1', name: '工学部1号館', latitude: 26.2508, longitude: 127.7662, rooms: [] },
  { id: 'eng-2', name: '工学部2号館', latitude: 26.2508, longitude: 127.7662, rooms: [] },
  { id: 'science', name: '理学部棟', latitude: 26.2515, longitude: 127.7678, rooms: [] },
]

before(async () => {
  if (process.env.MAP_SCREENSHOTS_DIR) await mkdir(process.env.MAP_SCREENSHOTS_DIR, { recursive: true })
  server = await createServer({
    cacheDir: 'node_modules/.vite-map-tests',
    optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-leaflet', 'leaflet', '@base-ui/react/drawer'] },
    server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error',
  })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`
})
after(async () => { await server?.close() })

async function openApp(page) {
  await page.route('**/src/services/buildings*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function fetchBuildings() { return ${JSON.stringify(buildings)} }
      export async function createRoom() {} export async function createOutlet() {}`,
  }))
  // No test writes or reads production records.
  await page.route('**/rest/v1/**', route => route.abort())
  await page.goto(baseURL)
  await page.locator('.building-marker').first().waitFor()
}

for (const [label, browserType] of [['Chrome', chromium], ['WebKit', webkit]]) {
  test(`${label}: location consent, retries, revocation and unmount manage a single live watch`, async () => {
    const browser = await browserType.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 393, height: 852 } })
      page.setDefaultTimeout(8000)
      await page.addInitScript(() => {
        const permission = new EventTarget()
        permission.state = 'prompt'
        window.geoWatches = new Map()
        window.geoStarts = 0
        window.geoClears = 0
        window.geoQueries = 0
        Object.defineProperty(navigator, 'permissions', { value: {
          async query() { window.geoQueries++; return permission },
        } })
        navigator.geolocation.watchPosition = (success, failure) => {
          const id = ++window.geoStarts
          window.geoWatches.set(id, { success, failure })
          window.lastGeoSuccess = success
          return id
        }
        navigator.geolocation.clearWatch = id => {
          if (window.geoWatches.delete(id)) window.geoClears++
        }
        window.geoPermission = state => {
          permission.state = state
          permission.dispatchEvent(new Event('change'))
        }
        window.geoFix = () => {
          for (const watch of window.geoWatches.values()) {
            watch.success({ coords: { latitude: 26.2508, longitude: 127.7662, accuracy: 5 }, timestamp: Date.now() })
          }
        }
      })
      await page.route('**/src/services/buildings*', route => route.fulfill({
        contentType: 'text/javascript', body: `export async function fetchBuildings() { return ${JSON.stringify(buildings)} }
          export async function createRoom() {} export async function createOutlet() {}`,
      }))
      await page.route('**/rest/v1/**', route => route.abort())
      await page.goto(`${baseURL}/tests/browser-harness.html`)
      await page.evaluate(async () => {
        const { React, createRoot } = await import('/tests/browser-harness.mjs')
        const { default: App } = await import('/src/App.jsx')
        await import('/src/index.css')
        window.testRoot = createRoot(document.getElementById('root'))
        window.testRoot.render(React.createElement(React.StrictMode, null, React.createElement(App)))
      })
      await page.waitForFunction(() => window.geoQueries >= 2)
      assert.equal(await page.evaluate(() => window.geoStarts), 0)
      const locate = page.getByRole('button', { name: '現在地を拡大して表示' })
      await locate.click()
      assert.equal(await page.evaluate(() => window.geoWatches.size), 1)
      await page.evaluate(() => {
        for (const watch of window.geoWatches.values()) watch.failure({ code: 3, message: 'Timeout' })
      })
      await page.getByRole('status').filter({ hasText: '現在地を取得できませんでした' }).waitFor()
      await locate.click()
      assert.equal(await page.evaluate(() => window.geoWatches.size), 1)
      await page.evaluate(() => { window.geoPermission('granted'); window.geoFix() })
      await page.locator('.location-dot').waitFor()
      await page.locator('.leaflet-control-zoom-in.leaflet-disabled').waitFor()
      assert.equal(await page.evaluate(() => window.geoStarts), 2)
      await page.evaluate(() => {
        for (const watch of window.geoWatches.values()) watch.failure({ code: 3, message: 'Timeout' })
      })
      await page.getByRole('status').filter({ hasText: '現在地を取得できませんでした' }).waitFor()
      assert.equal(await page.locator('.location-dot').count(), 1)
      await page.evaluate(() => window.geoFix())
      await page.waitForFunction(() => document.querySelector('.map-location-status').textContent === '')
      await page.evaluate(() => window.geoPermission('denied'))
      await page.locator('.location-dot').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => window.geoWatches.size), 0)
      await page.evaluate(() => window.lastGeoSuccess({ coords: { latitude: 26.2508, longitude: 127.7662, accuracy: 5 }, timestamp: Date.now() }))
      assert.equal(await page.locator('.location-dot').count(), 0)
      await page.evaluate(() => { window.geoPermission('granted'); window.geoFix() })
      await page.locator('.location-dot').waitFor()
      assert.equal(await page.evaluate(() => window.geoWatches.size), 1)
      await page.evaluate(() => window.testRoot.unmount())
      assert.equal(await page.evaluate(() => window.geoWatches.size), 0)
      assert.equal(await page.evaluate(() => window.geoClears), 3)
      await page.evaluate(() => window.geoPermission('granted'))
      assert.equal(await page.evaluate(() => window.geoStarts), 3)
    } finally {
      await browser.close()
    }
  })
}

for (const [label, browserType, viewport] of [
  ['Chrome mobile', chromium, { width: 393, height: 852 }],
  ['Chrome narrow', chromium, { width: 320, height: 568 }],
  ['Chrome desktop', chromium, { width: 1280, height: 800 }],
  ['WebKit mobile', webkit, { width: 393, height: 852 }],
  ['WebKit landscape', webkit, { width: 667, height: 375 }],
]) {
  test(`${label}: live location, compact list and individual building selection`, async () => {
    const browser = await browserType.launch()
    try {
      const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, permissions: ['geolocation'], geolocation: {
        latitude: 26.2508, longitude: 127.7662, accuracy: 5,
      } })
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        const watch = navigator.geolocation.watchPosition.bind(navigator.geolocation)
        window.geoWatchStarts = 0
        navigator.geolocation.watchPosition = (success, failure, options) => {
          window.geoWatchStarts++
          window.geoFailure = failure
          return watch(success, failure, options)
        }
      })
      await openApp(page)
      await page.locator('.location-dot').waitFor()
      await page.locator('.leaflet-control-zoom-out.leaflet-disabled').waitFor()
      if (viewport.width < 761) {
        await page.waitForFunction(expected => {
          const sheet = document.querySelector('.sheet-visible-area')
          return sheet && Math.abs(sheet.getBoundingClientRect().height - innerHeight * expected) < 2
        }, viewport.width > viewport.height ? 0.4 : 0.3)
        assert.equal(await page.locator('.mobile-list-button').count(), 0)
      }
      assert.equal(await page.locator('.leaflet-control-zoom-in.leaflet-disabled').count(), 0)
      const initialLocation = await page.locator('.location-marker').getAttribute('style')
      const initialBuilding = await page.locator('.building-marker').first().boundingBox()
      await page.getByRole('button', { name: '琉CHARGE 地図全体に戻る' }).click()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const resetBuilding = await page.locator('.building-marker').first().boundingBox()
      assert.deepEqual(resetBuilding, initialBuilding)
      await context.setGeolocation({ latitude: 26.2493, longitude: 127.7648, accuracy: 5 })
      await page.waitForFunction(previous => document.querySelector('.location-marker').getAttribute('style') !== previous, initialLocation)
      assert.deepEqual(await page.locator('.building-marker').first().boundingBox(), initialBuilding)
      await context.setGeolocation({ latitude: 26.2508, longitude: 127.7662, accuracy: 5 })
      await page.waitForFunction(previous => document.querySelector('.location-marker').getAttribute('style') === previous, initialLocation)
      const buildingMarker = name => page.locator(`.building-marker[title="${name}"]`)
      assert.equal(await page.locator('.building-marker').count(), buildings.length)
      assert.equal(await page.locator('.marker-group').count(), 0)
      assert.equal(await page.locator('.building-marker-connector').count(), 0)
      const firstMarker = await buildingMarker('工学部1号館').boundingBox()
      const secondMarker = await buildingMarker('工学部2号館').boundingBox()
      assert.ok(Math.abs(firstMarker.x - secondMarker.x) <= 20)
      await buildingMarker('工学部2号館').click()
      await page.getByRole('heading', { name: '工学部2号館', exact: true }).waitFor()
      assert.equal(await page.locator('.building-marker-selected').count(), 1)

      await page.getByRole('button', { name: '詳細を閉じる' }).click()
      if (viewport.width < 761) {
        await page.getByRole('button', { name: '建物一覧を閉じる' }).click()
        const openingHeights = await page.evaluate(async () => {
          const heights = []
          const record = () => {
            const sheet = document.querySelector('.sheet-visible-area')
            if (sheet) heights.push(sheet.getBoundingClientRect().height)
          }
          const observer = new MutationObserver(record)
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
          document.querySelector('.mobile-list-button').click()
          for (let frame = 0; frame < 8; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve))
            record()
          }
          observer.disconnect()
          return heights
        })
        assert.ok(openingHeights.length > 0)
        assert.ok(Math.max(...openingHeights) <= viewport.height * (viewport.width > viewport.height ? 0.4 : 0.3) + 2,
          `list flashed larger than compact size: ${openingHeights.join(', ')}`)
        await page.locator('.mobile-detail-panel').waitFor()
        await page.waitForFunction(() => {
          const sheet = document.querySelector('.sheet-visible-area').getBoundingClientRect()
          const location = document.querySelector('.map-location').getBoundingClientRect()
          const zoom = document.querySelector('.leaflet-control-zoom').getBoundingClientRect()
          return location.bottom <= sheet.top && zoom.bottom <= sheet.top
        })
        const fraction = viewport.width > viewport.height ? 0.4 : 0.3
        await page.waitForFunction(expected => {
          const height = document.querySelector('.sheet-visible-area').getBoundingClientRect().height
          return Math.abs(height - window.innerHeight * expected) < 2
        }, fraction)
        if (process.env.MAP_SCREENSHOTS_DIR) {
          await page.screenshot({ path: `${process.env.MAP_SCREENSHOTS_DIR}/${label.replaceAll(' ', '-')}-list.png` })
        }
        await page.getByRole('button', { name: '建物一覧を広げる' }).click()
        await page.waitForFunction(() => document.querySelector('.map-layout').classList.contains('sheet-expanded'))
        await page.getByRole('button', { name: '建物一覧を縮める' }).click()
        await page.getByRole('button', { name: '建物一覧を閉じる' }).click()
        assert.equal(await page.locator('.mobile-detail-panel').count(), 0)
      }

      const locate = page.getByRole('button', { name: '現在地を拡大して表示' })
      await locate.click()
      await page.locator('.leaflet-control-zoom-in.leaflet-disabled').waitFor()
      assert.equal(await page.evaluate(() => window.geoWatchStarts), 1)
      const locationSize = await page.locator('.location-dot').evaluate(node => node.getBoundingClientRect().width)
      assert.equal(locationSize, 22)
      assert.equal(await page.locator('.building-marker').count(), buildings.length)
      assert.equal(await page.locator('.location-marker').count(), 1)

      // Even at identical coordinates, the dot stays in front and each building
      // remains individually clickable, including with a keyboard.
      for (const name of ['工学部1号館', '工学部2号館']) {
        await buildingMarker(name).click()
        await page.getByRole('heading', { name, exact: true }).waitFor()
        await page.waitForFunction(() => {
          const dot = document.querySelector('.location-dot').getBoundingClientRect()
          return document.elementFromPoint(dot.x + dot.width / 2, dot.y + dot.height / 2)?.classList.contains('location-dot')
        })
        await page.getByRole('button', { name: '詳細を閉じる' }).click()
      }
      await buildingMarker('工学部1号館').focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: '工学部1号館', exact: true }).waitFor()
      await page.getByRole('button', { name: '詳細を閉じる' }).click()

      for (const size of [30, 32, 34]) {
        await page.locator('.leaflet-control-zoom-out').click()
        await page.waitForFunction(expected =>
          document.querySelector('.building-marker').getBoundingClientRect().width === expected, size)
        assert.equal(await page.locator('.location-dot').evaluate(node => node.getBoundingClientRect().width), locationSize)
        assert.equal(await page.locator('.building-marker').count(), buildings.length)
      }
      assert.equal(await page.locator('.leaflet-control-zoom-out.leaflet-disabled').count(), 1)
      if (process.env.MAP_SCREENSHOTS_DIR) {
        await page.screenshot({ path: `${process.env.MAP_SCREENSHOTS_DIR}/${label.replaceAll(' ', '-')}-overview.png` })
      }
      await page.locator('.location-dot').click()
      await page.locator('.leaflet-control-zoom-in.leaflet-disabled').waitFor()
      if (process.env.MAP_SCREENSHOTS_DIR) {
        await page.screenshot({ path: `${process.env.MAP_SCREENSHOTS_DIR}/${label.replaceAll(' ', '-')}-overlap.png` })
      }

      // Away from buildings, show a distinct location dot and retain it on errors.
      const oldPosition = await page.locator('.location-marker').getAttribute('style')
      await context.setGeolocation({ latitude: 26.2493, longitude: 127.7648, accuracy: 5 })
      await page.waitForFunction(previous => document.querySelector('.location-marker').getAttribute('style') !== previous, oldPosition)
      await locate.click()
      await page.locator('.location-marker').waitFor()
      await page.locator('.location-marker').click()
      if (process.env.MAP_SCREENSHOTS_DIR) {
        await page.screenshot({ path: `${process.env.MAP_SCREENSHOTS_DIR}/${label.replaceAll(' ', '-')}-location.png` })
      }
      assert.equal(await page.locator('.leaflet-control-zoom-in.leaflet-disabled').count(), 1)
      await context.setGeolocation({ latitude: 35.68, longitude: 139.76 })
      await page.getByRole('status').filter({ hasText: '現在地は表示範囲外です' }).waitFor()
      assert.equal(await page.locator('.location-marker').count(), 0)
      assert.equal(await locate.isEnabled(), true)
      await page.evaluate(() => window.geoFailure({ code: 1, message: 'Permission denied' }))
      await page.getByRole('status').filter({ hasText: '位置情報の利用を許可してください' }).waitFor()
      assert.equal(await page.locator('.location-marker').count(), 0)
      await page.getByRole('button', { name: '琉CHARGE 地図全体に戻る' }).click()
      await page.locator('.leaflet-control-zoom-out.leaflet-disabled').waitFor()
      await page.waitForFunction(width =>
        document.querySelector('.building-marker').getBoundingClientRect().width === width, initialBuilding.width)
      assert.deepEqual(await page.locator('.building-marker').first().boundingBox(), initialBuilding)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  })
}
