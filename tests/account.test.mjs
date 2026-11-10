import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountService } from '../src/services/account.js'
import { isValidNickname, normalizeNickname } from '../src/utils/nickname.js'

function fixture() {
  const requests = []
  const profiles = new Map()
  let authError = null
  let profileError = null
  const client = {
    auth: {
      async signInWithOtp(request) { requests.push(request); return { error: authError } },
      async verifyOtp(request) { requests.push(request); return { error: authError } },
    },
    from(table) {
      assert.equal(table, 'profiles')
      return {
        select() {
          return { eq(column, id) {
            assert.equal(column, 'id')
            return { async maybeSingle() { return { data: profiles.get(id) ?? null, error: profileError } } }
          } }
        },
        async upsert(profile, options) {
          assert.deepEqual(options, { onConflict: 'id', ignoreDuplicates: true })
          if (!profiles.has(profile.id) && !profileError) profiles.set(profile.id, profile)
          return { error: profileError }
        },
      }
    },
  }
  return {
    account: createAccountService(client), requests, profiles,
    failAuth(error) { authError = error },
    failProfile(error) { profileError = error },
  }
}

const user = { id: 'user-1', email: 'student@ie.u-ryukyu.ac.jp', user_metadata: { nickname: '  りゅう  ' } }

test('login forbids automatic signup and never submits a nickname', async () => {
  const { account, requests } = fixture()
  assert.equal(await account.sendCode({ email: ' STUDENT@IE.U-RYUKYU.AC.JP ', mode: 'login', nickname: '別名' }), user.email)
  assert.deepEqual(requests, [{ email: user.email, options: { shouldCreateUser: false } }])
})

test('signup sends a normalized nickname, and resending preserves the registration request', async () => {
  const { account, requests } = fixture()
  const request = { email: user.email, mode: 'signup', nickname: '　りゅう　' }
  await account.sendCode(request)
  await account.sendCode(request)
  assert.deepEqual(requests, Array(2).fill({ email: user.email, options: { shouldCreateUser: true, data: { nickname: 'りゅう' } } }))
})

test('invalid names, modes and university lookalike domains never reach the auth API', async () => {
  const { account, requests } = fixture()
  for (const nickname of ['', '　 ', 'あ'.repeat(21), '改\n行']) {
    await assert.rejects(account.sendCode({ email: user.email, mode: 'signup', nickname }))
  }
  await assert.rejects(account.sendCode({ email: 'x@u-ryukyu.ac.jp.example.com', mode: 'login' }))
  await assert.rejects(account.sendCode({ email: user.email, mode: 'other' }))
  assert.equal(requests.length, 0)
  assert.equal(isValidNickname('😀'.repeat(20)), true)
  assert.equal(isValidNickname('😀'.repeat(21)), false)
  assert.equal(normalizeNickname('　りゅう '), 'りゅう')
})

test('login and signup pass each fresh CAPTCHA token without changing OTP options', async () => {
  for (const mode of ['login', 'signup']) {
    const { account, requests } = fixture()
    const request = { email: user.email, mode, nickname: '　りゅう　' }
    await account.sendCode({ ...request, captchaToken: 'first-token' })
    await account.sendCode({ ...request, captchaToken: 'resend-token' })
    assert.deepEqual(requests, ['first-token', 'resend-token'].map(captchaToken => ({
      email: user.email,
      options: {
        shouldCreateUser: mode === 'signup',
        ...(mode === 'signup' ? { data: { nickname: 'りゅう' } } : {}),
        captchaToken,
      },
    })))
    assert.equal('captchaToken' in request, false)
  }
})

test('CAPTCHA rejection is propagated without retrying the API without a token', async () => {
  const f = fixture()
  const error = { code: 'captcha_failed', status: 400 }
  f.failAuth(error)
  await assert.rejects(
    f.account.sendCode({ email: user.email, mode: 'login', captchaToken: 'rejected-token' }),
    actual => actual === error,
  )
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].options.captchaToken, 'rejected-token')
})

test('both modes use the same eight-digit OTP verification and propagate auth failures', async () => {
  const f = fixture()
  for (const code of ['123456', '123456789', 'abcdefgh']) {
    await assert.rejects(f.account.verifyCode({ email: user.email, code }))
  }
  assert.equal(f.requests.length, 0)
  await f.account.verifyCode({ email: user.email, code: '12345678' })
  assert.deepEqual(f.requests, [{ email: user.email, token: '12345678', type: 'email' }])
  const error = new Error('otp expired')
  f.failAuth(error)
  await assert.rejects(f.account.verifyCode({ email: user.email, code: '12345678' }), error)
  await assert.rejects(f.account.sendCode({ email: user.email, mode: 'login' }), error)
})

test('verified signup initializes a public profile and survives a reload', async () => {
  const { account, profiles } = fixture()
  assert.deepEqual(await account.loadProfile(user), { id: user.id, nickname: 'りゅう' })
  assert.equal(profiles.size, 1)
  assert.deepEqual(await account.loadProfile(user), { id: user.id, nickname: 'りゅう' })
})

test('re-registration and concurrent initial setup preserve an existing nickname', async () => {
  const { account, profiles } = fixture()
  profiles.set(user.id, { id: user.id, nickname: '元の名前' })
  assert.equal((await account.loadProfile(user)).nickname, '元の名前')
  assert.equal((await account.initializeProfile(user, '別名')).nickname, '元の名前')
  assert.equal(profiles.size, 1)
})

test('legacy accounts require initial setup and failed saves can be retried', async () => {
  const f = fixture()
  const legacy = { ...user, user_metadata: {} }
  assert.equal(await f.account.loadProfile(legacy), null)
  const error = new Error('database unavailable')
  f.failProfile(error)
  await assert.rejects(f.account.initializeProfile(legacy, 'りゅう'), error)
  f.failProfile(null)
  assert.equal((await f.account.initializeProfile(legacy, 'りゅう')).nickname, 'りゅう')
  assert.equal(f.profiles.size, 1)
})
