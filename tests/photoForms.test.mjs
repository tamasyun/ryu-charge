import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
let server, browser, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-forms-tests', optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch()
})
after(async () => { await browser?.close(); await server?.close() })

test('review: processing disables submit, reselection/removal cannot restore stale previews, failures retry', async () => {
  const page = await browser.newPage()
  await page.route('**/src/services/reviews*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function createReview(record) {
      window.posts.push(record);
      if (window.failSave) throw new Error('DB保存に失敗しました');
    }
  ` }))
  await page.goto(`${baseURL}/tests/browser-harness.html`)
  await page.evaluate(async () => {
    window.posts = []
    const { createRoot, React, ReviewForm } = await import('/tests/browser-harness.mjs')
    createRoot(document.getElementById('root')).render(React.createElement(ReviewForm, {
      roomId: 'room-1', canPost: true, onSubmitted: () => { window.submitted = true },
    }))
  })
  await page.getByRole('button', { name: '4つ星' }).click()
  const input = page.locator('input[type=file]')
  assert.match(await input.getAttribute('accept'), /image\/heic/)
  // デコードを実行する間だけ遅延させ、再選択の競合を再現する。
  await page.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      window.originalToBlob.call(this, blob => setTimeout(() => callback(blob), 300), ...args)
    }
  })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 240, 120)
    return [...new Uint8Array(await (await new Promise(resolve => window.originalToBlob.call(canvas, resolve, 'image/png'))).arrayBuffer())]
  })
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.getByRole('status').waitFor()
  assert.equal(await page.getByRole('button', { name: '写真を変換中...' }).isDisabled(), true)
  await page.getByRole('button', { name: '写真を削除' }).click()
  await page.waitForTimeout(800)
  assert.equal(await page.getByAltText('プレビュー').count(), 0)
  await input.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await input.setInputFiles({ name: 'third.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.getByAltText('プレビュー').waitFor()
  await page.getByRole('button', { name: '投稿する', exact: true }).waitFor()
  await page.evaluate(() => { window.failSave = true })
  await page.getByRole('button', { name: '投稿する', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').textContent(), /DB保存/)
  assert.deepEqual(await page.evaluate(() => ({ name: window.posts[0].imageFile.name, type: window.posts[0].imageFile.type })), { name: 'third.webp', type: 'image/webp' })
  await page.evaluate(() => { window.failSave = false })
  await page.getByRole('button', { name: '投稿する', exact: true }).click()
  await page.waitForFunction(() => window.submitted)
  await page.getByRole('button', { name: '写真を削除' }).click()
  await input.setInputFiles({ name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') })
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('button', { name: '投稿する', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '写真を削除' }).click()
  assert.equal(await page.getByRole('button', { name: '投稿する', exact: true }).isEnabled(), true)
  await page.close()
})

test('room UI: accepts five HEIC files in selection order and announces progress', async () => {
  const page = await browser.newPage()
  await page.route('**/src/services/reviews*', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function createReview() {}' }))
  await page.goto(`${baseURL}/tests/browser-harness.html`)
  await page.evaluate(async () => {
    const { createRoot, React, BuildingRooms } = await import('/tests/browser-harness.mjs')
    window.root = createRoot(document.getElementById('root'))
    window.renderRooms = progress => window.root.render(React.createElement(BuildingRooms, {
      building: { id: 'building-1', rooms: [{ id: 'room-1', name: '101', outlets: [] }] },
      reviewOverview: { buildingId: 'building-1', status: 'ready', byRoom: {} },
      canPost: true, uploadingRoomId: progress ? 'room-1' : null, photoProgress: progress,
      onAddPhotos: (_id, files) => { window.selectedPhotos = files.map(file => file.name); window.renderRooms({ phase: 'processing', current: 1, total: files.length }) },
    }))
    window.renderRooms(null)
  })
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.heic`, mimeType: 'image/heic', buffer: Buffer.from('selection test') })))
  await page.getByRole('status').waitFor()
  assert.deepEqual(await page.evaluate(() => window.selectedPhotos), ['0.heic', '1.heic', '2.heic', '3.heic', '4.heic'])
  assert.match(await page.getByRole('status').textContent(), /変換中.*1 \/ 5/s)
  assert.equal(await page.locator('input[type=file]').isDisabled(), true)
  await page.evaluate(() => window.renderRooms({ phase: 'uploading', current: 5, total: 5 }))
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('アップロード中'))
  await page.close()
})
