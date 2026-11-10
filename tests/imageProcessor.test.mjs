import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium, webkit } from '@playwright/test'

let server, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-image-tests', optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`
})
after(async () => { await server?.close() })

const browsers = [['Chromium', chromium, {}], ['WebKit', webkit, {}]]
if (process.env.RYU_TEST_CHROME) browsers.push(['Google Chrome', chromium, { channel: 'chrome' }])

for (const [name, browserType, launchOptions] of browsers) {
  test(`${name}: real canvas encoders, decoders and HEIC fallback`, { timeout: 120000 }, async t => {
    const browser = await browserType.launch({ headless: true, ...launchOptions })
    try {
      t.diagnostic(`${name} ${browser.version()}`)
      const page = await browser.newPage()
      await page.goto(`${baseURL}/tests/browser-harness.html`)
      await page.evaluate(async () => {
        const processor = await import('/src/utils/imageProcessor.js')
        window.processor = processor
        window.makeImage = async (type, width = 240, height = 120, transparent = false) => {
          if (type === 'image/webp') {
            const blob = await (await fetch('/tests/fixtures/metadata.webp')).blob()
            return new File([blob], 'metadata.webp', { type: 'image/webp' })
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, width / 2, height)
          ctx.fillStyle = '#0000ff'; ctx.fillRect(width / 2, 0, width / 2, height)
          if (transparent) ctx.clearRect(0, 0, 10, 10)
          const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.98))
          return new File([blob], `pattern.${type.split('/')[1]}`, { type: blob.type })
        }
        window.describeImage = async file => {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const bitmap = await createImageBitmap(file)
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close()
          const sample = (x, y) => [...ctx.getImageData(x, y, 1, 1).data]
          return { ...processor.inspectImage(bytes, file.type), name: file.name, size: file.size,
            alpha: sample(0, 0)[3], top: sample(canvas.width / 2, canvas.height / 4),
            bottom: sample(canvas.width / 2, canvas.height * 3 / 4),
            metadata: /Exif|GPSLatitude|2026:11:06|private-photo-metadata/.test(new TextDecoder().decode(bytes)),
          }
        }
      })
      for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
        await t.test(`${type}: size, alpha, metadata and valid output`, async () => {
          const result = await page.evaluate(async type => {
            const input = await window.makeImage(type, 2400, 1200, type !== 'image/jpeg')
            const output = await window.processor.processImage(input)
            return { input: input.size, output: await window.describeImage(output) }
          }, type)
          assert.equal(result.output.width, 1600)
          assert.equal(result.output.height, 800)
          assert.equal(result.output.metadata, false)
          if (type !== 'image/jpeg') assert.equal(result.output.alpha, 0)
          assert.ok(result.output.size < result.input)
          assert.equal(result.output.type, 'image/webp')
          assert.match(result.output.name, /\.(webp|png|jpg)$/)
        })
      }
      await t.test('JPEG EXIF orientation=6 and capture date are baked/removed', async () => {
        const result = await page.evaluate(async () => {
          const input = await window.makeImage('image/jpeg')
          // TIFF little endian: Orientation=6、DateTimeOriginal相当の個人情報マーカー。
          const exif = new Uint8Array([0xff,0xe1,0,0,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0])
          const marker = new TextEncoder().encode('private-photo-metadata 2026:11:06 GPSLatitude')
          const length = exif.length - 2 + marker.length
          exif[2] = length >> 8; exif[3] = length & 255
          const bytes = new Uint8Array(await input.arrayBuffer())
          const file = new File([bytes.slice(0,2), exif, marker, bytes.slice(2)], 'oriented.jpg', { type: input.type })
          return window.describeImage(await window.processor.processImage(file))
        })
        assert.equal(result.width, 120); assert.equal(result.height, 240)
        assert.ok(result.top[0] > 200); assert.ok(result.bottom[2] > 200)
        assert.equal(result.metadata, false)
      })
      await t.test('all eight EXIF rotations and mirror directions match known quadrant positions', async () => {
        const results = await page.evaluate(async () => {
          const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 60
          const ctx = canvas.getContext('2d')
          const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00']
          for (let i = 0; i < 4; i++) { ctx.fillStyle = colors[i]; ctx.fillRect((i % 2) * 60, Math.floor(i / 2) * 30, 60, 30) }
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.98))
          const { stripImageMetadata } = await import('/src/utils/imageMetadata.js')
          // SafariのCanvasが付ける既定のEXIFを除き、重複APP1でない入力を作る。
          const clean = stripImageMetadata(new Uint8Array(await blob.arrayBuffer()), 'image/jpeg', true)
          const bytes = new Uint8Array(await clean.arrayBuffer()), results = []
          for (let orientation = 1; orientation <= 8; orientation++) {
            const exif = new Uint8Array([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0])
            const file = new File([bytes.slice(0, 2), exif, bytes.slice(2)], 'quadrants.jpg', { type: 'image/jpeg' })
            const bitmap = await createImageBitmap(await window.processor.processImage(file))
            const output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height
            const context = output.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close()
            results.push([0,1,2,3].map(i => {
              const [r, g, b] = context.getImageData(output.width * (i % 2 ? 0.75 : 0.25), output.height * (i > 1 ? 0.75 : 0.25), 1, 1).data
              return r > 180 && g > 180 ? 'D' : r > 180 ? 'A' : g > 180 ? 'B' : b > 180 ? 'C' : '?'
            }).join(''))
          }
          return results
        })
        assert.deepEqual(results, ['ABCD', 'BADC', 'DCBA', 'CDAB', 'ACBD', 'CADB', 'DBCA', 'BDAC'])
      })
      for (const type of ['png', 'webp']) {
        await t.test(`${type}: EXIF orientation is preserved before metadata removal`, async () => {
          const result = await page.evaluate(async type => {
            const blob = await (await fetch(`/tests/fixtures/oriented.${type}`)).blob()
            return window.describeImage(await window.processor.processImage(new File([blob], `oriented.${type}`, { type: `image/${type}` })))
          }, type)
          assert.ok(result.height > result.width)
          assert.ok(result.top[0] > 200); assert.ok(result.bottom[2] > 200)
          assert.equal(result.metadata, false)
        })
      }
      await t.test('small images stay small; no original file bypass', async () => {
        const result = await page.evaluate(async () => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          const decoded = await createImageBitmap(original)
          canvas.getContext('2d').drawImage(decoded, 0, 0); decoded.close()
          const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          const webp = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8))
          const output = await window.processor.processImage(new File([original], 'tiny.png', { type: png.type }))
          const { stripImageMetadata } = await import('/src/utils/imageMetadata.js')
          return { actual: await window.describeImage(output), png: stripImageMetadata(new Uint8Array(await png.arrayBuffer()), png.type).size, webp: stripImageMetadata(new Uint8Array(await webp.arrayBuffer()), webp.type).size, supportedWebp: webp.type === 'image/webp' }
        })
        assert.equal(result.actual.width, 1); assert.equal(result.actual.height, 1)
        assert.ok(result.actual.size > 0)
        assert.equal(result.actual.alpha, 0)
      })
      await t.test('PNG metadata chunks are removed', async () => {
        const result = await page.evaluate(async () => {
          const blob = await (await fetch('/tests/fixtures/metadata.png')).blob()
          return window.describeImage(await window.processor.processImage(new File([blob], 'metadata.png', { type: 'image/png' })))
        })
        assert.equal(result.metadata, false)
      })
      await t.test('larger WebP candidate loses to a re-encoded PNG', async () => {
        const result = await page.evaluate(async () => {
          const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200
          const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1200, 1200); ctx.fillStyle = 'blue'; ctx.fillRect(1200, 0, 1200, 1200); ctx.clearRect(0, 0, 10, 10)
          const input = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          // 有効なWebPに無害なJUNKチャンクを足し、再エンコード候補の大小を制御する。
          // 出力は1600pxなので、先に本物の共通処理で同サイズのWebPを作る。
          const seed = await window.processor.processImage(new File([await (await fetch('/tests/fixtures/metadata.webp')).blob()], 'seed.webp', { type: 'image/webp' }))
          const bitmap = await createImageBitmap(seed)
          const small = document.createElement('canvas'); small.width = bitmap.width; small.height = bitmap.height; small.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close()
          const bytes = new Uint8Array(await seed.arrayBuffer())
          if (seed.type !== 'image/webp') throw new Error('WebP encoder is required')
          const padded = new Uint8Array(bytes.length + 1024 * 1024 + 8); padded.set(bytes)
          padded.set(new TextEncoder().encode('JUNK'), bytes.length)
          const view = new DataView(padded.buffer); view.setUint32(bytes.length + 4, 1024 * 1024, true); view.setUint32(4, padded.length - 8, true)
          const original = HTMLCanvasElement.prototype.toBlob
          HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
            if (type === 'image/webp') callback(new Blob([padded], { type }))
            else original.call(this, callback, type, quality)
          }
          try { return window.describeImage(await window.processor.processImage(new File([input], 'pattern.png', { type: 'image/png' }))) }
          finally { HTMLCanvasElement.prototype.toBlob = original }
        })
        assert.equal(result.type, 'image/png')
        assert.equal(result.alpha, 0)
      })
      await t.test('input >5MB can post after recompression; originals never win', async () => {
        const result = await page.evaluate(async () => {
          const input = await window.makeImage('image/jpeg')
          const large = new File([input, new Uint8Array(6 * 1024 * 1024)], 'large.jpg', { type: input.type })
          const output = await window.processor.processImage(large)
          return { input: large.size, output: output.size }
        })
        assert.ok(result.input > 5 * 1024 * 1024)
        assert.ok(result.output < 5 * 1024 * 1024)
      })
      await t.test('five mixed-format photos finish conversion before a single ordered DB insert', async () => {
        const result = await page.evaluate(async () => {
          const files = [await window.makeImage('image/jpeg'), await window.makeImage('image/png'), await window.makeImage('image/webp')]
          const heic = await (await fetch('/tests/fixtures/portrait.heic')).blob()
          files.push(new File([heic], 'four.heic', { type: 'image/heic' }), new File([heic], 'five.heif', { type: 'image/heif' }))
          const { createPhotoUploader } = await import('/src/services/photoUpload.js')
          const paths = [], types = [], batches = []
          const client = { storage: { from() { return {
            async upload(path, file, options) { paths.push(path); types.push([file.type, options.contentType]); return {} },
            getPublicUrl(path) { return { data: { publicUrl: path } } },
          } } }, from() { return { insert(records) { batches.push(records); return { async select() { return { data: records } } } } } } }
          const upload = createPhotoUploader(client, { track: () => {} })
          const rows = await upload({ bucket: 'room-photos', folder: '101', table: 'room_photos', files, makeRecord: (storage_path, image_url) => ({ storage_path, image_url, room_id: '101' }) })
          return { paths, types, rows, batches: batches.length }
        })
        assert.equal(result.rows.length, 5); assert.equal(result.batches, 1)
        assert.deepEqual(result.rows.map(row => row.storage_path), result.paths)
        assert.ok(result.types.every(([type, contentType]) => type === contentType && ['image/jpeg', 'image/png', 'image/webp'].includes(type)))
      })
      await t.test('rejects even valid encoded images if final output still exceeds 5MB', async () => {
        const message = await page.evaluate(async () => {
          const input = await window.makeImage('image/jpeg')
          const seed = await window.processor.processImage(await window.makeImage('image/png'))
          if (seed.type !== 'image/webp') throw new Error('WebP encoder is required')
          const bytes = new Uint8Array(await seed.arrayBuffer())
          const padded = new Uint8Array(bytes.length + 6 * 1024 * 1024 + 8); padded.set(bytes)
          padded.set(new TextEncoder().encode('JUNK'), bytes.length)
          const view = new DataView(padded.buffer); view.setUint32(bytes.length + 4, 6 * 1024 * 1024, true); view.setUint32(4, padded.length - 8, true)
          const original = HTMLCanvasElement.prototype.toBlob
          HTMLCanvasElement.prototype.toBlob = function(callback, type) {
            // 両方の有効な候補を5MB超にして、最終上限の判定を再現する。
            if (type === 'image/webp') callback(new Blob([padded], { type }))
            else original.call(this, blob => callback(new Blob([blob, new Uint8Array(6 * 1024 * 1024)], { type: 'image/jpeg' })), 'image/jpeg', 0.8)
          }
          try { await window.processor.processImage(input); return 'success' }
          catch (error) { return error.message }
          finally { HTMLCanvasElement.prototype.toBlob = original }
        })
        assert.match(message, /圧縮後.*5MB/)
      })
      for (const mime of ['image/heic', 'image/heif']) {
        await t.test(`${mime}: portrait, orientation, metadata and fallback`, async () => {
          const bytes = await readFile(new URL('./fixtures/portrait.heic', import.meta.url))
          const result = await page.evaluate(async ({ bytes, mime }) => {
            const file = new File([new Uint8Array(bytes)], 'portrait.' + mime.split('/')[1], { type: mime })
            return window.describeImage(await window.processor.processImage(file))
          }, { bytes: [...bytes], mime })
          assert.equal(result.width, 120); assert.equal(result.height, 240)
          assert.ok(result.top[0] > 200); assert.ok(result.bottom[2] > 200)
          assert.equal(result.metadata, false)
          assert.notEqual(result.type, mime)
        })
      }
      await t.test('rejects MIME spoofing, broken decode, pixel bombs and oversized input', async () => {
        const errors = await page.evaluate(async () => {
          const input = await window.makeImage('image/png')
          const bytes = new Uint8Array(await input.arrayBuffer())
          const huge = bytes.slice(); new DataView(huge.buffer).setUint32(16, 100000)
          const cases = [new File([input], 'spoof.jpg', { type: 'image/jpeg' }),
            new File([bytes.slice(0, 33)], 'broken.png', { type: input.type }),
            new File([huge], 'bomb.png', { type: input.type }),
            new File([new Uint8Array(31 * 1024 * 1024)], 'oversize.jpg', { type: 'image/jpeg' })]
          const results = []
          for (const file of cases) {
            try { await window.processor.processImage(file); results.push('success') }
            catch (error) { results.push(error.message) }
          }
          return results
        })
        assert.equal(errors.length, 4)
        assert.ok(errors.every(message => message !== 'success'))
        assert.match(errors[0], /MIME/); assert.match(errors[2], /画素/); assert.match(errors[3], /30MB/)
      })
      if (process.env.RYU_IPHONE_FIXTURE) {
        await t.test('public iPhone HEIC sample keeps native landscape orientation and removes metadata', async () => {
          const bytes = await readFile(process.env.RYU_IPHONE_FIXTURE)
          const result = await page.evaluate(async bytes => {
            const file = new File([new Uint8Array(bytes)], 'iphone.heic', { type: 'image/heic' })
            return window.describeImage(await window.processor.processImage(file))
          }, [...bytes])
          assert.equal(result.width, 1600)
          assert.equal(result.height, 1200)
          assert.equal(result.metadata, false)
        })
      }
    } finally { await browser.close() }
  })
}
