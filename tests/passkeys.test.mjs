import assert from 'node:assert/strict'
import test from 'node:test'
import { createPasskeyService, supportsPasskeys } from '../src/services/passkeys.js'
import { createAccountService } from '../src/services/account.js'

function fixture() {
  const calls = []
  const user = { id: 'user-1', email: 'student@ie.u-ryukyu.ac.jp' }
  let authError = null
  let claimed = true
  let profile = { id: user.id, nickname: 'りゅう' }
  const client = {
    auth: {
      async signInWithPasskey(value) { calls.push(['signIn', value]); return { data: { user }, error: authError } },
      async registerPasskey() { calls.push(['register']); return { data: { id: 'key-1' }, error: authError } },
      async signOut(options) { calls.push(['signOut', options]); return { error: null } },
      passkey: {
        async list() { calls.push(['list']); return { data: [{ id: 'key-1' }], error: authError } },
        async update(value) { calls.push(['update', value]); return { data: value, error: authError } },
        async delete(value) { calls.push(['delete', value]); return { error: authError } },
      },
    },
    from() {
      return {
        select() { return { eq() { return { async maybeSingle() { calls.push(['profile']); return { data: profile, error: null } } } } } },
        update(value) {
          calls.push(['nickname', value])
          return { eq(column, id) {
            calls.push(['owner', column, id])
            return { select() { return { async single() { return { data: { id, ...value }, error: authError } } } } }
          } }
        },
      }
    },
    async rpc(name) { calls.push(['rpc', name]); const data = claimed; claimed = false; return { data, error: null } },
  }
  return { service: createPasskeyService(client), account: createAccountService(client), calls, user,
    fail(error) { authError = error }, legacy() { claimed = false }, missing() { profile = null } }
}

test('official passkey methods receive exact SDK parameters including CAPTCHA', async () => {
  const f = fixture()
  await f.service.signIn('fresh-captcha')
  await f.service.register()
  assert.deepEqual(await f.service.list(), [{ id: 'key-1' }])
  await f.service.rename('key-1', '　iPhone　')
  await f.service.remove('key-1')
  assert.deepEqual(f.calls, [
    ['signIn', { options: { captchaToken: 'fresh-captcha' } }], ['register'], ['list'],
    ['update', { passkeyId: 'key-1', friendlyName: 'iPhone' }], ['delete', { passkeyId: 'key-1' }],
  ])
})

test('non-university passkey sign-in is signed out locally', async () => {
  const f = fixture()
  f.user.email = 'user@example.com'
  await assert.rejects(f.service.signIn(), /琉球大学/)
  assert.deepEqual(f.calls.at(-1), ['signOut', { scope: 'local' }])
})

test('invalid passkey names never reach Auth; SDK failures propagate', async () => {
  const f = fixture()
  for (const value of ['', ' ', 'a'.repeat(121), '改\n行']) await assert.rejects(f.service.rename('key', value))
  assert.equal(f.calls.length, 0)
  const error = new Error('cancelled')
  f.fail(error)
  await assert.rejects(f.service.register(), error)
  await assert.rejects(f.service.list(), error)
  await assert.rejects(f.service.remove('key'), error)
  assert.equal(supportsPasskeys(), false)
})

test('nickname updates only the authenticated profile and preserves validation', async () => {
  const f = fixture()
  assert.deepEqual(await f.account.updateNickname(f.user, ' 新しい名前 '), { id: f.user.id, nickname: '新しい名前' })
  assert.deepEqual(f.calls, [['nickname', { nickname: '新しい名前' }], ['owner', 'id', f.user.id]])
  for (const value of ['', '😀'.repeat(21), '改\n行']) await assert.rejects(f.account.updateNickname(f.user, value))
  assert.equal(f.calls.length, 2)
})

test('first-signup enrollment claims only once after the profile exists', async () => {
  const f = fixture()
  assert.equal(await f.account.registerInitialPasskey(f.user), true)
  assert.equal(await f.account.registerInitialPasskey(f.user), false)
  assert.deepEqual(f.calls.slice(0, 3), [['profile'], ['rpc', 'claim_initial_passkey_enrollment'], ['register']])
  assert.equal(f.calls.filter(([method]) => method === 'register').length, 1)
})

test('legacy signup and cancelled first enrollment never trigger another automatic prompt or sign-out', async () => {
  const legacy = fixture()
  legacy.legacy()
  assert.equal(await legacy.account.registerInitialPasskey(legacy.user), false)
  assert.equal(legacy.calls.some(([method]) => method === 'register'), false)
  const fresh = fixture()
  fresh.fail(new Error('Safari user gesture required'))
  await assert.rejects(fresh.account.registerInitialPasskey(fresh.user))
  assert.equal(await fresh.account.registerInitialPasskey(fresh.user), false)
  assert.equal(fresh.calls.filter(([method]) => method === 'register').length, 1)
  assert.equal(fresh.calls.some(([method]) => method === 'signOut'), false)
})
