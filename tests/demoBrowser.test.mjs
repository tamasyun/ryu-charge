import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium, webkit } from '@playwright/test'

let server, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-demo-tests', optimizeDeps: {
    noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@base-ui/react/dialog', '@base-ui/react/drawer', 'leaflet', 'react-leaflet', '@supabase/supabase-js', '@marsidev/react-turnstile'],
  }, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://localhost:${server.httpServer.address().port}`
})
after(async () => { await server?.close() })

async function setup(browser, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const writes = [], reads = [], notices = [], errors = []
  const buildings = [{ id: 'b1', name: 'テスト棟', latitude: 26.248, longitude: 127.766,
    rooms: [{ id: 'r1', name: '公開教室', floor: 1, location_detail: '公開の場所', outlets: [], user_id: null }] }]
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { notices.push(dialog.message()); await dialog.accept() })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === new URL(baseURL).origin) return route.continue()
    // タイル・CAPTCHA等の外部通信はテスト中に使わない。
    if (!/\/(rest|auth|storage|functions)\/v1\//.test(url.pathname)) return route.abort()
    if (request.method() !== 'GET') { writes.push([request.method(), url.pathname]); return route.abort() }
    reads.push({ path: url.pathname, anonymous: request.headers().authorization === `Bearer ${request.headers().apikey}` })
    let data = []
    if (url.pathname.endsWith('/buildings')) data = buildings
    if (url.pathname.endsWith('/room_reviews') && url.searchParams.get('select')?.includes('comment')) {
      data = [{ id: 'public-review', rating: 3, comment: '公開レビュー', user_id: null, created_at: '2026-11-01T00:00:00Z' }]
    }
    await route.fulfill({ json: data })
  })
  await page.goto(baseURL)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'ログイン', exact: true })
  await dialog.getByLabel('大学のメールアドレス').fill('demo@example.com')
  await dialog.locator('form').getByRole('button', { name: 'ログイン', exact: true }).click()
  await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor().catch(async error => {
    throw new Error(JSON.stringify({ body: await page.locator('body').innerText(), errors, notices, writes }), { cause: error })
  })
  return { context, page, writes, reads, notices, errors, buildings }
}

test('shared desktop app: local posting, fresh public data, photos, WebAuthn registration/sign-in and normal logout', async () => {
  const browser = await chromium.launch()
  try {
    const f = await setup(browser, { width: 1280, height: 850 })
    const { page } = f
    assert.equal(f.notices.length, 1)
    assert.match(f.notices[0], /このブラウザ内だけ/)
    assert.equal(await page.getByText(/デモ用画面|保存されません/).count(), 0)
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('room')
    await page.getByLabel('教室名').fill('ローカル教室')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    await page.getByRole('heading', { name: /ローカル教室/ }).waitFor()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('outlet')
    await page.getByLabel('教室 *', { exact: true }).selectOption('r1')
    await page.getByLabel('コンセントの位置').fill('試用のコンセント')
    await page.getByLabel('AC差込口数').fill('2')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    await page.getByText('試用のコンセント', { exact: true }).waitFor()

    await page.getByRole('button', { name: /レビューを見る/ }).first().click()
    await page.getByText('公開レビュー', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '削除', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'レビューを投稿', exact: true }).click()
    await page.getByRole('button', { name: '5つ星' }).click()
    await page.getByLabel('コメント（任意）').fill('ブラウザだけのレビュー')
    await page.getByRole('button', { name: '投稿する', exact: true }).click()
    await page.getByText('ブラウザだけのレビュー', { exact: true }).waitFor()
    await page.getByRole('button', { name: '削除', exact: true }).click()
    await page.getByRole('button', { name: 'レビューを投稿', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByText('ブラウザだけのレビュー', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '← 建物に戻る' }).click()
    const photo = await readFile(new URL('./fixtures/oriented.png', import.meta.url))
    await page.getByLabel('公開教室に写真を追加', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo })
    await page.getByRole('button', { name: '公開教室のコンセント・教室の写真を全画面表示' }).waitFor()

    f.buildings[0].rooms.push({ id: 'latest', name: '新たな公開教室', floor: 2, outlets: [] })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading', { name: /新たな公開教室/ }).waitFor()
    await page.getByRole('heading', { name: /ローカル教室/ }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('heading', { name: /ローカル教室/ }).waitFor()
    await page.getByRole('button', { name: '公開教室のコンセント・教室の写真を全画面表示' }).waitFor()

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } })
    await page.evaluate(async () => {
      const { demoPasskeys } = await import('/src/demo/passkeys.js')
      const register = demoPasskeys.register
      demoPasskeys.register = async () => {
        try { return await register() } catch (error) { window.demoPasskeyError = `${error.name}: ${error.message}`; throw error }
      }
    })
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).click()
    await page.getByRole('button', { name: 'パスキー管理', exact: true }).click()
    await page.getByRole('button', { name: 'パスキーを登録', exact: true }).click()
    await page.getByText('パスキーを登録しました。', { exact: true }).waitFor().catch(async error => {
      throw new Error(await page.evaluate(() => window.demoPasskeyError), { cause: error })
    })
    await page.getByRole('button', { name: '名前を変更', exact: true }).click()
    await page.getByLabel('パスキーの名前').fill('デモ端末')
    await page.getByRole('button', { name: '名前を保存', exact: true }).click()
    await page.getByRole('heading', { name: 'デモ端末', exact: true }).waitFor()
    await page.getByRole('button', { name: '閉じる', exact: true }).click()
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await page.getByRole('button', { name: 'ログイン', exact: true }).click()
    const login = page.getByRole('dialog', { name: 'ログイン', exact: true })
    await login.getByLabel('大学のメールアドレス').fill('demo@example.com')
    await login.getByRole('button', { name: 'パスキーでログイン', exact: true }).click()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('heading', { name: /新たな公開教室/ }).waitFor()
    assert.equal(await page.getByRole('heading', { name: /ローカル教室/ }).count(), 0)
    assert.equal(await page.getByText('試用のコンセント', { exact: true }).count(), 0)
    assert.equal(await page.locator('img[src^="data:"]').count(), 0)

    await page.getByRole('button', { name: 'ログイン', exact: true }).click()
    const again = page.getByRole('dialog', { name: 'ログイン', exact: true })
    await again.getByLabel('大学のメールアドレス').fill('demo@example.com')
    await again.locator('form').getByRole('button', { name: 'ログイン', exact: true }).click()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).click()
    await page.getByRole('button', { name: 'ユーザー名変更', exact: true }).click()
    await page.getByLabel('ニックネーム', { exact: true }).fill('試用ユーザー')
    await page.getByRole('button', { name: 'ユーザー名を保存', exact: true }).click()
    await page.getByText('ユーザー名を保存しました。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '閉じる', exact: true }).click()
    await page.getByRole('button', { name: '試用ユーザーのアカウント設定' }).click()
    await page.getByRole('button', { name: 'アカウント削除', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '削除用コードを送信' }).count(), 0)
    await page.getByLabel('削除対象を確認しました', { exact: true }).check()
    await page.getByLabel('最終確認として「削除する」と入力してください').fill('削除する')
    await page.getByRole('button', { name: 'アカウントを完全に削除する', exact: true }).click()
    await page.getByRole('button', { name: 'ログイン', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('ryu-charge:demo:v1')), null)
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.errors, [])
    assert.ok(f.reads.length > 0)
    assert.ok(f.reads.every(read => read.anonymous))
    await f.context.close()
  } finally { await browser.close() }
})

test('mobile WebKit uses the same map and account screens and keeps trials in the browser', async () => {
  const browser = await webkit.launch()
  try {
    const f = await setup(browser, { width: 393, height: 852 })
    const { page } = f
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('room')
    await page.getByLabel('教室名').fill('スマホの試用教室')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    await page.getByRole('heading', { name: /スマホの試用教室/ }).waitFor()
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.equal(sizes.scroll, sizes.width)
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.errors, [])
    await f.context.close()
  } finally { await browser.close() }
})
