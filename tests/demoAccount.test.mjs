import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoAccount, DEMO_STORAGE_KEY, isDemoEmail } from '../src/demo/account.js'
import { createAppAuth } from '../src/demo/auth.js'
import { guardedFetch } from '../src/demo/network.js'

function memory() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

function fixture() {
  const storage = memory(), session = memory()
  let sequence = 0
  const options = { storage: () => storage, session: () => session, uuid: () => `local-${++sequence}` }
  return { demo: createDemoAccount(options), storage, session, options }
}

test('reserved email is exact; local account persists without a server session', () => {
  const f = fixture()
  assert.equal(isDemoEmail(' DEMO@EXAMPLE.COM '), true)
  for (const email of ['x-demo@example.com', 'demo@example.com.evil', 'demo@u-ryukyu.ac.jp', null]) assert.equal(isDemoEmail(email), false)
  const { user } = f.demo.signIn()
  assert.equal(user.user_metadata.nickname, 'デモアカウント')
  f.demo.add('rooms', [{ id: 'local-room', building_id: 'building', name: 'テスト教室' }])
  const reload = createDemoAccount(f.options)
  assert.equal(reload.getUser().id, user.id)
  assert.equal(reload.rows('rooms').length, 1)
  f.demo.signOut()
  assert.equal(reload.getUser(), null)
  assert.throws(() => reload.rows('rooms'))
  reload.signIn()
  assert.equal(reload.rows('rooms').length, 1)
  const otherBrowser = fixture()
  otherBrowser.demo.signIn()
  assert.equal(otherBrowser.demo.rows('rooms').length, 0)
})

test('fresh public records are overlaid, never frozen or modified; authors track the local nickname', () => {
  const { demo, storage } = fixture()
  demo.signIn()
  const live = [{ id: 'building', rooms: [{ id: 'public-room', name: '公開教室', outlets: [] }] }]
  demo.add('rooms', [{ id: 'local-room', building_id: 'building', name: '試す教室' }])
  demo.add('outlets', [{ room_id: 'public-room', location_detail: '窓際' }])
  const before = structuredClone(live)
  const first = demo.mergeBuildings(live)
  assert.deepEqual(live, before)
  assert.equal(first[0].rooms.length, 2)
  assert.equal(first[0].rooms.find(room => room.id === 'public-room').outlets.length, 1)
  demo.updateNickname('試用ユーザー')
  live[0].rooms.push({ id: 'latest-room', name: '最新教室', outlets: [] })
  const latest = demo.mergeBuildings(live)
  assert.equal(latest[0].rooms.length, 3)
  assert.equal(latest[0].rooms.find(room => room.id === 'local-room').author_nickname, '試用ユーザー')
  assert.equal(storage.getItem(DEMO_STORAGE_KEY).includes('最新教室'), false)
})

test('only local reviews can be deleted; quota failures and in-flight mode changes never fall through', () => {
  const { demo, storage } = fixture()
  demo.signIn()
  const [review] = demo.add('reviews', [{ room_id: 'public-room', rating: 5 }])
  assert.throws(() => demo.add('reviews', [{ room_id: 'public-room', rating: 2 }]), /既に/)
  assert.throws(() => demo.removeReview('public-review'), /自分/)
  demo.removeReview(review.id)
  assert.equal(demo.reviews('public-room').length, 0)
  const guard = demo.capture()
  demo.signOut()
  demo.signIn()
  assert.throws(guard, /ログイン状態/)
  storage.setItem = () => { throw new Error('quota') }
  assert.throws(() => demo.add('photos', [{ image_url: 'data:image/png;base64,large' }]), /保存できません/)
  assert.equal(demo.rows('photos').length, 0)
})

test('demo auth events overlay real auth, and demo logout never signs out or writes the real account', async () => {
  const { demo } = fixture()
  const realSession = { user: { id: 'real-user' } }
  let signouts = 0, realCallback, unsubscribed = false
  const auth = createAppAuth({
    onAuthStateChange(callback) {
      realCallback = callback
      callback('INITIAL_SESSION', realSession)
      return { data: { subscription: { unsubscribe() { unsubscribed = true } } } }
    },
    async signOut() { signouts++; return { error: null } },
  }, demo)
  const events = []
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => events.push([event, session?.user?.id]))
  const { user } = demo.signIn()
  realCallback('TOKEN_REFRESHED', realSession)
  assert.equal(events.at(-1)[1], user.id)
  assert.equal((await auth.getUser()).data.user.id, user.id)
  await auth.signOut()
  assert.equal(signouts, 0)
  assert.equal(events.at(-1)[1], 'real-user')
  subscription.unsubscribe()
  assert.equal(unsubscribed, true)
  await auth.signOut()
  assert.equal(signouts, 1)
})

test('fetch guard blocks all mutation methods and Request objects before reaching the network', async () => {
  let demo = true
  const requests = []
  const fetcher = async (...args) => { requests.push(args); return new Response('[]') }
  const guarded = guardedFetch({ isDemo: () => demo, fetcher })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(guarded('https://example.com', { method }), /変更できません/)
    await assert.rejects(guarded(new Request('https://example.com', { method })), /変更できません/)
  }
  assert.equal(requests.length, 0)
  await guarded('https://example.com', { method: 'GET' })
  demo = false
  await guarded('https://example.com', { method: 'POST' })
  assert.equal(requests.length, 2)
  const readOnly = guardedFetch({ readOnly: true, fetcher })
  await assert.rejects(readOnly('https://example.com', { method: 'POST' }))
})

test('local account deletion removes the overlay and credential metadata, leaving unrelated storage intact', () => {
  const { demo, storage } = fixture()
  storage.setItem('production-auth', 'untouched')
  demo.signIn()
  demo.savePasskeys([{ id: 'passkey' }])
  assert.deepEqual(demo.removeAccount(), { deleted: true })
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null)
  assert.equal(storage.getItem('production-auth'), 'untouched')
  assert.equal(demo.isActive(), false)
})
