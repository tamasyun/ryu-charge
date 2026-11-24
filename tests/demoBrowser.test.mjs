import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium, expect, webkit } from '@playwright/test'

let server, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-demo-tests', optimizeDeps: {
    noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@base-ui/react/dialog', '@base-ui/react/drawer', '@base-ui/react/menu', 'leaflet', 'react-leaflet', '@supabase/supabase-js', '@marsidev/react-turnstile'],
  }, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://localhost:${server.httpServer.address().port}`
})
after(async () => { await server?.close() })

async function setup(browser, viewport, { registerOnFirstLogin = false } = {}) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  let cdp, authenticatorId
  if (registerOnFirstLogin) {
    cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    ;({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } }))
  } else {
    await context.addInitScript(() => {
      if (!navigator.credentials) return
      const create = navigator.credentials.create.bind(navigator.credentials)
      navigator.credentials.create = async () => { throw new DOMException('cancelled', 'NotAllowedError') }
      window.restoreDemoCredentials = () => { navigator.credentials.create = create }
    })
  }
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
    if (url.pathname.endsWith('/academic_units')) {
      data = [
        { id: 'engineering', name: '工学部', parent_id: null },
        { id: 'engineering-department', name: '工学科', parent_id: 'engineering' },
        { id: 'mechanical', name: '機械工学コース', parent_id: 'engineering-department' },
        { id: 'computer-science', name: '知能情報コース', parent_id: 'engineering-department' },
        { id: 'science', name: '理学部', parent_id: null },
        { id: 'humanities', name: '人文社会学部', parent_id: null },
        { id: 'law-politics', name: '国際法政学科', parent_id: 'humanities' },
        { id: 'law', name: '法学プログラム', parent_id: 'law-politics' },
        { id: 'advanced-legal-practice', name: '特修法曹コース', parent_id: 'law' },
      ]
    }
    if (url.pathname.endsWith('/room_reviews') && url.searchParams.get('select')?.includes('comment') && url.searchParams.get('room_id') === 'eq.r1') {
      data = [{ id: 'public-review', rating: 3, comment: '公開レビュー', user_id: null, created_at: '2026-11-01T00:00:00Z' }]
    }
    await route.fulfill({ json: data })
  })
  await page.goto(baseURL)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'ログイン', exact: true })
  await dialog.getByLabel('大学のメールアドレス').fill('demo@example.com')
  const initialNotice = page.waitForEvent('dialog')
  await dialog.locator('form').getByRole('button', { name: 'ログイン', exact: true }).click()
  await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor().catch(async error => {
    throw new Error(JSON.stringify({ body: await page.locator('body').innerText(), errors, notices, writes }), { cause: error })
  })
  await initialNotice
  return { context, page, writes, reads, notices, errors, buildings, cdp, authenticatorId }
}

async function choosePostAction(page, triggerName, action) {
  await page.getByRole('button', { name: triggerName, exact: true }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: action, exact: true }).click()
}

test('room access form selects a collapsed faculty and saves editable schedules', async () => {
  const browser = await webkit.launch()
  try {
    const { page, writes, errors } = await setup(browser, { width: 393, height: 852 })
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('room-access')
    const faculty = page.getByRole('checkbox', { name: '工学部', exact: true })
    await faculty.check()
    await expect(page.getByRole('button', { name: '工学部を展開' })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('input[name="academic_unit_id"]')).toHaveValue('engineering')

    await page.getByRole('button', { name: '工学部を展開' }).click()
    await page.getByRole('button', { name: '工学科を展開' }).click()
    const mechanical = page.getByRole('checkbox', { name: '機械工学コース' })
    const computerScience = page.getByRole('checkbox', { name: '知能情報コース' })
    await expect(mechanical).toBeChecked()
    await expect(computerScience).toBeChecked()
    await computerScience.uncheck()
    assert.equal(await faculty.evaluate(input => input.indeterminate), true)
    await expect(page.locator('input[name="academic_unit_id"]')).toHaveValue('mechanical')
    await faculty.click()
    await expect(computerScience).toBeChecked()

    await page.getByRole('button', { name: '人文社会学部を展開' }).click()
    await page.getByRole('button', { name: '国際法政学科を展開' }).click()
    await page.getByRole('button', { name: '法学プログラムを展開' }).click()
    const legalPractice = page.getByRole('checkbox', { name: '特修法曹コース', exact: true })
    await legalPractice.check()
    const law = page.getByRole('checkbox', { name: '法学プログラム', exact: true })
    assert.equal(await law.evaluate(input => input.indeterminate), true)
    assert.deepEqual(await page.locator('input[name="academic_unit_id"]').evaluateAll(
      inputs => inputs.map(input => input.value)
    ), ['engineering', 'advanced-legal-practice'])
    await legalPractice.uncheck()

    await page.getByRole('checkbox', { name: '月', exact: true }).check()
    await page.getByRole('checkbox', { name: '水', exact: true }).check()
    await page.getByLabel('開始', { exact: true }).fill('09:00')
    await page.getByLabel('終了', { exact: true }).fill('17:00')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    const section = page.getByRole('region', { name: '教室の情報' })
    await expect(section.getByText('月・水曜日 09:00〜17:00')).toBeVisible()
    await expect(section.getByText('工学部', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await expect(page.getByText('この建物の教室には利用条件が登録済みです。')).toBeVisible()
    await expect(page.getByRole('button', { name: '追加する', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
    await choosePostAction(page, '教室の情報（月・水曜日 09:00〜17:00）の操作', '編集')
    await expect(faculty).toBeChecked()
    await expect(page.getByRole('checkbox', { name: '水', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: '終日' }).check()
    await page.getByRole('button', { name: '保存する', exact: true }).click()
    await expect(section.getByText('月・水曜日 終日')).toBeVisible()
    await choosePostAction(page, '教室の情報（月・水曜日 終日）の操作', '削除')
    await expect(section.getByText('利用条件は未登録です。')).toBeVisible()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await expect(page.getByLabel('教室 *', { exact: true })).toHaveValue('r1')
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})

test('first browser login automatically registers a working passkey; reload and later login do not repeat enrollment', async () => {
  const browser = await chromium.launch()
  try {
    const f = await setup(browser, { width: 1280, height: 850 }, { registerOnFirstLogin: true })
    const { page, cdp, authenticatorId } = f
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ryu-charge:demo:v1')))
    assert.equal(stored.passkeys.length, 1)
    assert.equal(stored.initialPasskeyEnrollmentClaimed, true)
    await page.reload()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await page.getByRole('button', { name: 'ログイン', exact: true }).click()
    const login = page.getByRole('dialog', { name: 'ログイン', exact: true })
    assert.equal(await login.getByLabel('大学のメールアドレス').inputValue(), '')
    await login.getByRole('button', { name: 'パスキーでログイン', exact: true }).click()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    assert.equal((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length, 1)
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.errors, [])
    await f.context.close()
  } finally { await browser.close() }
})

for (const [label, browserType, viewport] of [
  ['Chrome desktop', chromium, { width: 1280, height: 850 }],
  ['WebKit mobile', webkit, { width: 393, height: 852 }],
]) {
  test(`${label}: building details let demo users edit and delete their own room and outlet posts`, async () => {
    const browser = await browserType.launch()
    try {
      const { page, writes } = await setup(browser, viewport)
      await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
      await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
      await page.getByLabel('追加するもの').selectOption('room')
      await page.getByLabel('教室名').fill('自分の教室')
      await page.getByRole('button', { name: '追加する', exact: true }).click()
      await page.getByRole('button', { name: /^自分の教室/ }).click()
      await page.getByText('編集・削除期限', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'レビューを投稿' }).click()
      const roomActions = page.getByRole('button', { name: '教室の操作' })
      await expect(roomActions).toHaveCount(0)
      await page.getByRole('button', { name: '← 教室に戻る' }).click()
      const menu = page.getByRole('menu')
      await expect(menu).toHaveCount(0)
      await roomActions.press('ArrowDown')
      await expect(menu.getByRole('menuitem', { name: '編集' })).toBeFocused()
      await expect(menu.getByRole('menuitem', { name: '削除' })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(roomActions).toBeFocused()
      await roomActions.click()
      await expect(menu).toBeVisible()
      await page.getByRole('heading', { name: /^自分の教室/ }).click()
      await expect(menu).toHaveCount(0)
      await choosePostAction(page, '教室の操作', '編集')
      assert.equal(await page.getByLabel('教室名').inputValue(), '自分の教室')
      await page.getByLabel('教室名').fill('編集した教室')
      await page.getByRole('button', { name: '保存する', exact: true }).click()
      await page.getByRole('heading', { name: /^編集した教室/ }).waitFor()

      await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
      await page.getByLabel('追加するもの').selectOption('outlet')
      await page.getByLabel('教室 *', { exact: true }).selectOption({ label: '編集した教室' })
      await page.getByLabel('コンセントの位置').fill('自分のコンセント')
      await page.getByRole('button', { name: '追加する', exact: true }).click()
      await page.getByRole('heading', { name: /^編集した教室/ }).waitFor()
      await choosePostAction(page, '教室の操作', '削除')
      await page.getByRole('alert').filter({ hasText: '登録されている教室は削除できません' }).waitFor()
      await choosePostAction(page, 'コンセント「自分のコンセント」の操作', '編集')
      assert.equal(await page.getByLabel('コンセントの位置').inputValue(), '自分のコンセント')
      await page.getByLabel('コンセントの位置').fill('編集したコンセント')
      await page.getByLabel('AC差込口数').fill('0')
      await page.getByRole('button', { name: '保存する', exact: true }).click()
      await page.getByText('編集したコンセント', { exact: true }).waitFor()
      await page.getByText('AC 0口', { exact: true }).waitFor()
      await choosePostAction(page, 'コンセント「編集したコンセント」の操作', '削除')
      await page.getByText('コンセントは未登録です。', { exact: true }).waitFor()
      await choosePostAction(page, '教室の操作', '削除')
      await page.getByRole('button', { name: /^公開教室/ }).click()
      await page.getByText('公開レビュー', { exact: true }).waitFor()
      await expect(roomActions).toHaveCount(0)

      await page.evaluate(() => {
        const key = 'ryu-charge:demo:v1'
        const data = JSON.parse(localStorage.getItem(key))
        data.rooms.push({ id: 'expired', building_id: 'b1', name: '期限切れ教室',
          user_id: data.userId, created_at: '2020-01-01T00:00:00Z' })
        localStorage.setItem(key, JSON.stringify(data))
        window.dispatchEvent(new Event('focus'))
      })
      await page.getByRole('button', { name: '← 教室一覧に戻る' }).click()
      await page.getByRole('button', { name: /^期限切れ教室/ }).click()
      await page.getByText('教室の編集・削除期限は終了しました。').waitFor()
      await expect(roomActions).toHaveCount(0)
      assert.deepEqual(writes, [])
    } finally {
      await browser.close()
    }
  })
}

test('blank-email login explains when first demo passkey registration did not complete', async () => {
  const browser = await chromium.launch()
  try {
    const f = await setup(browser, { width: 390, height: 844 })
    assert.match(f.notices[0], /パスキーの登録は完了していません/)
    await f.page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await f.page.getByRole('button', { name: 'ログイン', exact: true }).click()
    const login = f.page.getByRole('dialog', { name: 'ログイン', exact: true })
    assert.equal(await login.getByLabel('大学のメールアドレス').inputValue(), '')
    await login.getByRole('button', { name: 'パスキーでログイン', exact: true }).click()
    await login.getByRole('alert').getByText(/このブラウザにはデモ用パスキーが登録されていません/).waitFor()
    assert.deepEqual(f.writes, [])
    await f.context.close()
  } finally { await browser.close() }
})

test('an existing demo account without a passkey gets one registration offer', async () => {
  const browser = await chromium.launch()
  try {
    const f = await setup(browser, { width: 390, height: 844 })
    await f.page.evaluate(() => {
      const key = 'ryu-charge:demo:v1'
      const data = JSON.parse(localStorage.getItem(key))
      delete data.initialPasskeyEnrollmentClaimed
      localStorage.setItem(key, JSON.stringify(data))
      window.restoreDemoCredentials?.()
    })
    const cdp = await f.context.newCDPSession(f.page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } })
    await f.page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await f.page.getByRole('button', { name: 'ログイン', exact: true }).click()
    const login = f.page.getByRole('dialog', { name: 'ログイン', exact: true })
    await login.getByLabel('大学のメールアドレス').fill('demo@example.com')
    await login.locator('form').getByRole('button', { name: 'ログイン', exact: true }).click()
    await f.page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    assert.equal(await f.page.evaluate(() => JSON.parse(localStorage.getItem('ryu-charge:demo:v1')).passkeys.length), 1)
    assert.deepEqual(f.writes, [])
    await f.context.close()
  } finally { await browser.close() }
})

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
    await page.getByRole('button', { name: /ローカル教室/ }).waitFor()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('outlet')
    await page.getByLabel('教室 *', { exact: true }).selectOption('r1')
    await page.getByLabel('コンセントの位置').fill('試用のコンセント')
    await page.getByLabel('AC差込口数').fill('2')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    await page.getByRole('button', { name: /公開教室/ }).click()
    await page.getByText('試用のコンセント', { exact: true }).waitFor()

    const roomDetails = page.locator('.room-detail-view')
    await roomDetails.getByRole('heading', { name: 'レビュー', exact: true }).waitFor()
    await roomDetails.getByText('公開レビュー', { exact: true }).waitFor()
    assert.equal(await roomDetails.locator('.room-detail + .room-reviews').count(), 1)
    await expect(page.getByRole('button', { name: 'レビューの操作' })).toHaveCount(0)
    await page.getByRole('button', { name: 'レビューを投稿', exact: true }).click()
    await page.getByRole('heading', { name: '公開教室のレビューを投稿' }).waitFor()
    assert.equal(await roomDetails.count(), 0)
    assert.equal(await page.getByRole('button', { name: '＋ 追加', exact: true }).count(), 0)
    await page.getByRole('button', { name: '5つ星' }).click()
    await page.getByLabel('コメント（任意）').fill('ブラウザだけのレビュー')
    const photo = await readFile(new URL('./fixtures/oriented.png', import.meta.url))
    await page.getByLabel('写真（任意）').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo })
    await page.getByAltText('プレビュー').waitFor()
    await page.getByRole('button', { name: '投稿する', exact: true }).click()
    await roomDetails.getByText('ブラウザだけのレビュー', { exact: true }).waitFor()
    assert.equal(await roomDetails.getByText('試用のコンセント', { exact: true }).count(), 1)
    const mine = roomDetails.locator('.review-item').filter({ hasText: 'ブラウザだけのレビュー' })
    const originalDate = await mine.locator('time').getAttribute('datetime')
    await choosePostAction(page, 'レビューの操作', '編集')
    await page.getByRole('heading', { name: '公開教室のレビューを編集' }).waitFor()
    assert.equal(await roomDetails.count(), 0)
    assert.equal(await page.getByRole('button', { name: '5つ星' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByLabel('コメント（任意）').inputValue(), 'ブラウザだけのレビュー')
    await page.getByAltText('投稿済みのレビュー写真').waitFor()
    await page.getByRole('button', { name: '2つ星' }).click()
    await page.getByLabel('コメント（任意）').fill('編集したレビュー')
    await page.getByRole('button', { name: '保存する', exact: true }).click()
    const edited = roomDetails.locator('.review-item').filter({ hasText: '編集したレビュー' })
    await edited.waitFor()
    assert.equal(await mine.count(), 0)
    assert.equal(await edited.locator('time').getAttribute('datetime'), originalDate)
    assert.equal(await edited.locator('[aria-label="2つ星"]').count(), 1)
    await edited.getByRole('button', { name: 'レビュー写真を全画面表示' }).waitFor()
    await roomDetails.getByText('★ 2.5 / 5（2件）', { exact: true }).waitFor()
    await choosePostAction(page, 'レビューの操作', '削除')
    await edited.waitFor({ state: 'detached' })
    await roomDetails.getByText('公開レビュー', { exact: true }).waitFor()
    assert.equal(await roomDetails.getByRole('button', { name: 'レビューを投稿', exact: true }).isEnabled(), true)
    await page.getByLabel('公開教室に写真を追加', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo })
    await page.getByRole('button', { name: '公開教室のコンセント・教室の写真を全画面表示' }).waitFor()

    f.buildings[0].rooms.push({ id: 'latest', name: '新たな公開教室', floor: 2, outlets: [] })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: '← 教室一覧に戻る' }).click()
    await page.getByRole('button', { name: /新たな公開教室/ }).waitFor()
    await page.getByRole('button', { name: /ローカル教室/ }).click()
    await roomDetails.getByText('まだレビューはありません。', { exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'デモアカウントのアカウント設定' }).waitFor()
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('button', { name: /ローカル教室/ }).waitFor()
    await page.getByRole('button', { name: /^公開教室/ }).click()
    await page.getByRole('button', { name: '公開教室のコンセント・教室の写真を全画面表示' }).waitFor()

    const cdp = await page.context().newCDPSession(page)
    await page.evaluate(() => window.restoreDemoCredentials?.())
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
    await page.getByRole('button', { name: /新たな公開教室/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /ローカル教室/ }).count(), 0)
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
    f.buildings[0].rooms[0].outlets = Array.from({ length: 12 }, (_, index) => ({
      id: `outlet-${index}`, location_detail: `コンセント ${index + 1}`, ac_ports: 2,
    }))
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await page.getByRole('button', { name: 'テスト棟', exact: true }).last().click()
    await page.getByRole('button', { name: /^公開教室/ }).click()
    const reviews = page.locator('.room-detail-view .room-reviews')
    await reviews.getByText('公開レビュー', { exact: true }).waitFor()
    await reviews.getByRole('button', { name: 'ログインして投稿' }).click()
    const login = page.getByRole('dialog', { name: 'ログイン', exact: true })
    await login.getByLabel('大学のメールアドレス').fill('demo@example.com')
    await login.locator('form').getByRole('button', { name: 'ログイン', exact: true }).click()
    await page.getByRole('heading', { name: '公開教室のレビューを投稿' }).waitFor()
    assert.equal(await reviews.count(), 0)
    const cancel = page.getByRole('button', { name: '← 教室に戻る' })
    await expect(cancel).toBeInViewport()
    await cancel.click()
    await reviews.getByText('公開レビュー', { exact: true }).waitFor()
    await reviews.getByRole('button', { name: 'レビューを投稿', exact: true }).click()
    await page.getByRole('button', { name: '4つ星' }).click()
    await page.getByRole('button', { name: '投稿する', exact: true }).click()
    await choosePostAction(page, 'レビューの操作', '編集')
    await page.getByRole('heading', { name: '公開教室のレビューを編集' }).waitFor()
    assert.equal(await reviews.count(), 0)
    await page.getByLabel('コメント（任意）').fill('スマホから編集')
    await page.getByRole('button', { name: '保存する', exact: true }).click()
    await reviews.getByText('スマホから編集', { exact: true }).waitFor()
    await page.getByRole('button', { name: '← 教室一覧に戻る' }).click()
    await page.getByRole('button', { name: '＋ 追加', exact: true }).click()
    await page.getByLabel('追加するもの').selectOption('room')
    await page.getByLabel('教室名').fill('スマホの試用教室')
    await page.getByRole('button', { name: '追加する', exact: true }).click()
    await page.getByRole('button', { name: /スマホの試用教室/ }).waitFor()
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.equal(sizes.scroll, sizes.width)
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.errors, [])
    await f.context.close()
  } finally { await browser.close() }
})
