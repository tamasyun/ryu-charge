import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { chromium, webkit } from '@playwright/test'

let server, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-viewer-tests', optimizeDeps: {
    noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@base-ui/react/dialog', '@base-ui/react/drawer'],
  }, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`
})
after(async () => { await server?.close() })

async function mount(page, { review = false, mobile = false, gallery = false } = {}) {
  await page.route('**/src/services/reviews*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function createReview() {}
    export async function deleteReview() {}
    export async function fetchReviews() { return [{ id: 'review-1', rating: 5,
      created_at: '2026-11-07T00:00:00Z', image_url: '/tests/fixtures/oriented.png' }] }
  ` }))
  await page.route('**/src/lib/supabase*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const supabase = { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }
    export const appAuth = supabase.auth
  ` }))
  await page.goto(`${baseURL}/tests/browser-harness.html`)
  await page.evaluate(async ({ review, mobile, gallery }) => {
    await import('/src/index.css')
    await import('/src/App.css')
    await import('/src/components/reviews/RoomReviews.css')
    const { React, createRoot, BuildingRooms } = await import('/tests/browser-harness.mjs')
    const { default: ReviewList } = await import('/src/components/reviews/ReviewList.jsx')
    const { default: BuildingDetailsPanel } = await import('/src/components/buildings/BuildingDetailsPanel.jsx')
    const building = { id: 'building-1', name: 'テスト棟', rooms: [
      { id: 'room-1', name: '101', outlets: [] },
      ...(gallery ? [{ id: 'room-2', name: '102', outlets: [] }] : []),
    ] }
    const content = review ? React.createElement(ReviewList, { roomId: 'room-1' }) : React.createElement(BuildingRooms, {
      building, reviewOverview: { buildingId: 'building-1', status: 'ready', byRoom: {} },
      roomPhotos: {
        'room-1': gallery ? [1, 2, 3].map(id => ({ id: `photo-${id}`, image_url: `/tests/fixtures/oriented.png?photo=${id}` }))
          : [{ id: 'photo-1', image_url: '/tests/fixtures/oriented.png' }],
        'room-2': [{ id: 'other-room', image_url: '/tests/fixtures/metadata.png' }],
      },
    })
    window.parentClosed = false
    createRoot(document.getElementById('root')).render(mobile ? React.createElement(BuildingDetailsPanel, {
      building, isMobile: true, snapPoints: [0.45, 0.9], snapIndex: 1,
      onSnapIndexChange() {}, onClose() { window.parentClosed = true },
    }, content) : content)
  }, { review, mobile, gallery })
}

async function assertCenteredIcon(button) {
  const buttonBox = await button.boundingBox()
  const iconBox = await button.locator('svg').boundingBox()
  assert.ok(Math.abs(iconBox.x + iconBox.width / 2 - buttonBox.x - buttonBox.width / 2) < 1)
  assert.ok(Math.abs(iconBox.y + iconBox.height / 2 - buttonBox.y - buttonBox.height / 2) < 1)
}

for (const [label, type, viewport] of [
  ['Chrome desktop', chromium, { width: 1280, height: 800 }],
  ['WebKit mobile', webkit, { width: 393, height: 852 }],
  ['WebKit landscape', webkit, { width: 667, height: 375 }],
]) {
  for (const review of [false, true]) {
    test(`${label}: ${review ? 'review' : 'room'} photo opens in place and closes accessibly`, async () => {
      const browser = await type.launch()
      try {
        const page = await browser.newPage({ viewport, hasTouch: viewport.width < 800 })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await mount(page, { review, mobile: viewport.width < 800 })
        const trigger = page.getByRole('button', { name: /の写真を全画面表示|レビュー写真を全画面表示/ })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: review ? 'レビュー写真' : '101のコンセント・教室の写真' })
        await dialog.waitFor()
        await page.waitForFunction(() => document.querySelector('.photo-viewer-image')?.naturalWidth > 0)
        const box = await dialog.boundingBox()
        assert.equal(box.x, 0); assert.equal(box.y, 0)
        assert.equal(box.width, viewport.width); assert.equal(box.height, viewport.height)
        const close = dialog.getByRole('button', { name: '写真を閉じる' })
        await assertCenteredIcon(close)
        const closeBox = await close.boundingBox()
        assert.ok(closeBox.x >= 0 && closeBox.y >= 0 && closeBox.x + closeBox.width <= viewport.width && closeBox.y + closeBox.height <= viewport.height)
        assert.equal(await dialog.locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain')
        assert.equal(await dialog.getByRole('button', { name: /前の写真|次の写真/ }).count(), 0)
        assert.equal(await dialog.locator('.photo-viewer-counter').count(), 0)
        assert.equal(page.context().pages().length, 1)
        assert.equal(page.url(), `${baseURL}/tests/browser-harness.html`)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        await page.waitForFunction(() => document.activeElement?.classList.contains('photo-viewer-trigger'))
        assert.equal(await page.evaluate(() => window.parentClosed), false)
        await trigger.press('Enter')
        await dialog.waitFor()
        await close.click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await page.evaluate(() => window.parentClosed), false)
        assert.deepEqual(errors, [])
      } finally { await browser.close() }
    })
  }

  test(`${label}: gallery starts at the selected photo and supports buttons, keys and swipes`, async () => {
    const browser = await type.launch()
    try {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width < 800 })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await mount(page, { gallery: true, mobile: viewport.width < 800 })
      if (viewport.width < 800) await assertCenteredIcon(page.getByRole('button', { name: '詳細を閉じる' }))
      const triggers = page.getByRole('button', { name: '101のコンセント・教室の写真を全画面表示' })
      await triggers.nth(1).click()
      const dialog = page.getByRole('dialog', { name: '101のコンセント・教室の写真' })
      const currentImage = dialog.locator('.yarl__slide_current img')
      const waitForPhoto = async number => {
        await page.waitForFunction(number => document.querySelector('.photo-viewer-counter')?.textContent === `${number} / 3`, number)
        assert.match(await currentImage.getAttribute('src'), new RegExp(`photo=${number}$`))
      }
      await waitForPhoto(2)
      await dialog.getByRole('button', { name: '次の写真' }).click()
      await waitForPhoto(3)
      // 次の操作はスライドの移動が終わってから行う。
      await page.waitForTimeout(550)
      await page.keyboard.press('ArrowLeft')
      await waitForPhoto(2)
      await page.waitForTimeout(550)
      await dialog.getByRole('button', { name: '前の写真' }).click()
      await waitForPhoto(1)
      await page.waitForTimeout(550)
      const area = await dialog.locator('.yarl__container').boundingBox()
      await page.mouse.move(area.x + area.width * 0.8, area.y + area.height / 2)
      await page.mouse.down()
      await page.mouse.move(area.x + area.width * 0.2, area.y + area.height / 2, { steps: 12 })
      await page.mouse.up()
      await waitForPhoto(2)
      await page.waitForTimeout(550)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await triggers.nth(1).evaluate(button => document.activeElement === button), true)
      assert.equal(await page.evaluate(() => window.parentClosed), false)
      await triggers.nth(2).click()
      await waitForPhoto(3)
      await dialog.getByRole('button', { name: '次の写真' }).click()
      await waitForPhoto(1)
      await assertCenteredIcon(dialog.getByRole('button', { name: '写真を閉じる' }))
      await dialog.getByRole('button', { name: '写真を閉じる' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await triggers.nth(2).evaluate(button => document.activeElement === button), true)
      assert.equal(await page.evaluate(() => window.parentClosed), false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })
}

test('broken photo shows a recoverable error and can still be closed', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('**/src/services/reviews*', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function createReview() {}' }))
    await page.goto(`${baseURL}/tests/browser-harness.html`)
    await page.evaluate(async () => {
      const { React, createRoot } = await import('/tests/browser-harness.mjs')
      const { default: PhotoViewer } = await import('/src/components/photos/PhotoViewer.jsx')
      createRoot(document.getElementById('root')).render(React.createElement(PhotoViewer, { photos: [
        { src: '/missing-photo.png', alt: 'テスト写真' },
        { src: '/tests/fixtures/oriented.png', alt: '読み込める写真' },
      ] }))
    })
    await page.getByRole('button', { name: 'テスト写真を全画面表示' }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /読み込めません/)
    await page.getByRole('button', { name: '次の写真' }).click()
    await page.waitForFunction(() => document.querySelector('.yarl__slide_current img')?.naturalWidth > 0)
    await page.getByRole('button', { name: '写真を閉じる' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  } finally { await browser.close() }
})
