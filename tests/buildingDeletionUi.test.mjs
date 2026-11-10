import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

let server, browser, baseURL
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-deletion-tests', optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@base-ui/react/dialog', '@base-ui/react/drawer'] }, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' })
  await server.listen()
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch()
})
after(async () => { await browser?.close(); await server?.close() })

async function openApp(viewport = { width: 1200, height: 900 }) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const mocks = {
    '/src/lib/supabase.js': `
      export function setKeepSignedIn() {}
      export const supabase = { auth: { onAuthStateChange(callback) {
        window.setUser = id => callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id, email: 'test@eve.u-ryukyu.ac.jp' } } : null);
        queueMicrotask(() => window.setUser('owner'));
        return { data: { subscription: { unsubscribe() {} } } };
      } } };
    `,
    '/src/hooks/useAccount.js': `export function useAccount() { return { profile: { nickname: 'テスト' }, status: 'ready', reloadProfile() {} }; }`,
    '/src/hooks/useReviewOverview.js': `export function useReviewOverview(building) { return { buildingId: building?.id, status: 'ready', byRoom: {} }; }`,
    '/src/services/RoomPhotos.js': `export async function fetchRoomPhotos() { return {}; } export async function uploadRoomPhotos() { return []; }`,
    '/src/components/map/CampusMap.jsx': `
      export default function Map({buildings, onSelectBuilding}) {
        return window.testReact.createElement('div', { className: 'map-area' }, buildings.map(b => window.testReact.createElement('button', { key: b.id, onClick: () => onSelectBuilding(b) }, b.name)));
      }
    `,
    '/src/components/auth/LoginDialog.jsx': `export default function LoginDialog() { return null; }`,
    '/src/components/auth/ProfileDialog.jsx': `export default function ProfileDialog() { return null; }`,
    '/src/services/buildings.js': `
      export async function fetchBuildings() { return [{ id: 'building', name: 'テスト棟', rooms: [
        { id: 'own-room', name: '101教室', user_id: 'owner', author_nickname: 'テスト', outlets: [
          { id: 'own-outlet', location_detail: '窓際', ac_ports: 2, user_id: 'owner', author_nickname: 'テスト' }
        ] },
        { id: 'other-room', name: '102教室', user_id: 'other', outlets: [
          { id: 'other-outlet', location_detail: '入口', user_id: 'other' },
          { id: 'own-outlet-2', location_detail: '後方', user_id: 'owner' }
        ] },
        { id: 'unknown-room', name: '103教室', user_id: null, outlets: [{ id: 'unknown-outlet', location_detail: '壁際', user_id: null }] }
      ] }]; }
      window.deletions = [];
      async function remove(type, id) {
        window.deletions.push({type, id});
        if (window.deferDeletion) await new Promise(resolve => { window.finishDeletion = resolve; });
        if (window.failDeletion) throw new Error('削除できませんでした。通信状態を確認してください。');
        return { imageCleanupPending: !!window.cleanupPending };
      }
      export const deleteRoom = id => remove('room', id);
      export const deleteOutlet = id => remove('outlet', id);
      export async function createRoom() {} export async function createOutlet() {}
    `,
  }
  await page.route('**/src/**', route => {
    const body = mocks[new URL(route.request().url()).pathname]
    return body ? route.fulfill({ contentType: 'text/javascript', body }) : route.continue()
  })
  // テストの認証・削除はモックだけを使い、本番APIへ通信しない。
  await page.route('https://*.supabase.co/**', route => route.abort())
  await page.goto(`${baseURL}/tests/browser-harness.html`)
  await page.evaluate(async () => {
    await import('/src/index.css')
    await import('/src/components/auth/LoginDialog.css')
    const { React, createRoot } = await import('/tests/browser-harness.mjs')
    window.testReact = React
    const { default: App } = await import('/src/App.jsx')
    createRoot(document.getElementById('root')).render(React.createElement(App))
  })
  await page.getByRole('button', { name: 'テスト棟', exact: true }).click()
  await page.getByRole('button', { name: '101教室を削除', exact: true }).waitFor()
  return { page, errors }
}

test('deletion UI limits controls to ownership and follows login/logout changes', async () => {
  const { page, errors } = await openApp()
  assert.equal(await page.locator('.delete-data-button').count(), 3)
  assert.equal(await page.getByRole('button', { name: '102教室を削除', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '103教室を削除', exact: true }).count(), 0)
  await page.evaluate(() => window.setUser(null))
  await page.waitForFunction(() => !document.querySelector('.delete-data-button'))
  await page.evaluate(() => window.setUser('other'))
  await page.getByRole('button', { name: '102教室を削除', exact: true }).waitFor()
  assert.equal(await page.locator('.delete-data-button').count(), 2)
  assert.deepEqual(errors, [])
  await page.close()
})

test('deletion UI cancels without API calls, preserves failed rows, prevents duplicate requests and updates counts', async () => {
  const { page, errors } = await openApp()
  const outlet = page.getByRole('button', { name: '101教室の窓際のコンセントを削除', exact: true })
  page.once('dialog', dialog => dialog.dismiss())
  await outlet.click()
  assert.deepEqual(await page.evaluate(() => window.deletions), [])
  await page.evaluate(() => { window.failDeletion = true })
  page.once('dialog', dialog => dialog.accept())
  await outlet.click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').textContent(), /通信状態/)
  assert.equal(await outlet.isEnabled(), true)
  await page.evaluate(() => { window.failDeletion = false; window.deferDeletion = true })
  page.once('dialog', dialog => dialog.accept())
  await outlet.click()
  await page.waitForFunction(() => !!window.finishDeletion)
  assert.equal(await outlet.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '101教室を削除', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('input[type=file]').first().isDisabled(), true)
  await page.evaluate(() => { window.deferDeletion = false; window.finishDeletion() })
  await outlet.waitFor({ state: 'detached' })
  assert.equal(await page.getByText('コンセントは未登録です。', { exact: true }).count(), 1)

  await page.evaluate(() => { window.cleanupPending = true })
  page.once('dialog', async dialog => {
    assert.match(dialog.message(), /写真・レビューも削除/)
    await dialog.accept()
  })
  await page.getByRole('button', { name: '101教室を削除', exact: true }).click()
  await page.getByRole('button', { name: '101教室を削除', exact: true }).waitFor({ state: 'detached' })
  assert.equal(await page.getByText('2教室', { exact: true }).count(), 1)
  assert.match(await page.getByRole('alert').textContent(), /教室と関連する投稿を削除しました.*回収は確認待ち/)
  assert.deepEqual(await page.evaluate(() => window.deletions), [
    { type: 'outlet', id: 'own-outlet' }, { type: 'outlet', id: 'own-outlet' }, { type: 'room', id: 'own-room' },
  ])
  assert.deepEqual(errors, [])
  await page.close()
})

test('mobile deletion buttons remain inside the drawer without horizontal overflow', async () => {
  const { page, errors } = await openApp({ width: 390, height: 844 })
  const button = page.getByRole('button', { name: '101教室を削除', exact: true })
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/private/tmp/ryu-charge-own-deletion-mobile.png' })
  await page.close()
})
