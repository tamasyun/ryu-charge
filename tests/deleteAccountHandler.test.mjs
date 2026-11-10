import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeleteAccountHandler, hashProof, reviewImagePath } from '../supabase/functions/delete-account/handler.js'

const origin = 'https://charge.example.com'
const supabaseUrl = 'https://project.supabase.co'
const user = { id: 'user-1', email: 'student@ie.u-ryukyu.ac.jp', email_confirmed_at: '2026-11-01T00:00:00Z' }
const proof = 'a'.repeat(64)

function fixture({ authError, otpError, otpUser = user, rpcError, storageError, deleteError, files = [], reviews = [] } = {}) {
  const calls = []
  const admin = {
    auth: {
      async getUser(token) { calls.push(['getUser', token]); return { data: { user }, error: authError } },
      admin: {
        async signOut(token, scope) { calls.push(['revoke', token, scope]); return { error: null } },
        async deleteUser(id, soft) { calls.push(['deleteUser', id, soft]); return { error: deleteError } },
      },
    },
    async rpc(name, params) {
      calls.push([name, params])
      return { data: name === 'prepare_account_deletion' ? files : name === 'account_deletion_status' ? true : null,
        error: name === 'prepare_account_deletion' ? rpcError : null }
    },
    from() {
      return { select() {
        return { eq(column, id) {
          assert.equal(column, 'user_id')
          assert.equal(id, user.id)
          return { order() {
            return { async range(start, end) {
              calls.push(['reviews', start, end])
              return { data: reviews.slice(start, end + 1), error: null }
            } }
          } }
        } }
      } }
    },
    storage: { from(bucket) { return { async remove(paths) { calls.push(['remove', bucket, paths]); return { error: storageError } } } } },
  }
  const createVerifier = () => ({ auth: { async verifyOtp(params) {
    calls.push(['verifyOtp', params])
    return { data: otpError ? null : { user: otpUser, session: { access_token: 'temporary-session' } }, error: otpError }
  } } })
  const handler = createDeleteAccountHandler({ admin, createVerifier, supabaseUrl, allowedOrigins: [origin] })
  async function request(body, { token = 'valid-jwt', requestOrigin = origin, method = 'POST' } = {}) {
    return handler(new Request('https://server/functions/v1/delete-account', {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: requestOrigin, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }))
  }
  return { request, calls }
}

test('only exact project Storage URLs become review-image paths', () => {
  assert.equal(reviewImagePath(`${supabaseUrl}/storage/v1/object/public/review-images/reviews/a%20b.jpg`, supabaseUrl), 'reviews/a b.jpg')
  for (const value of ['https://evil.example/reviews/a.jpg', `${supabaseUrl}/storage/v1/object/public/other/a.jpg`,
    `${supabaseUrl}/storage/v1/object/public/review-images/%2e%2e%2fa.jpg`, 'invalid', null]) {
    assert.equal(reviewImagePath(value, supabaseUrl), null)
  }
})

test('missing JWT, rejected JWT, disallowed origins and missing confirmation do not delete anything', async () => {
  for (const opts of [{ token: '' }, { requestOrigin: 'https://evil.example' }]) {
    const f = fixture()
    const res = await f.request({ action: 'delete', proof, confirmation: '削除する' }, opts)
    assert.ok([401, 403].includes(res.status))
    assert.equal(f.calls.some(([name]) => name === 'deleteUser' || name === 'prepare_account_deletion'), false)
  }
  const expired = fixture({ authError: { message: 'expired' } })
  assert.equal((await expired.request({ action: 'verify', code: '12345678' })).status, 401)
  const f = fixture()
  assert.equal((await f.request({ action: 'delete', proof, confirmation: 'delete' })).status, 400)
  assert.equal(f.calls.some(([name]) => name === 'deleteUser'), false)
})

test('deletion reauthentication verifies the canonical email and stores only a hash, not a session', async () => {
  const f = fixture()
  const res = await f.request({ action: 'verify', code: '12345678', userId: 'victim', email: 'victim@example.com' })
  assert.equal(res.status, 200)
  const result = await res.json()
  assert.match(result.proof, /^[0-9a-f]{64}$/)
  assert.equal(result.session, undefined)
  assert.deepEqual(f.calls.find(([method]) => method === 'verifyOtp')[1], { email: user.email, token: '12345678', type: 'email' })
  assert.deepEqual(f.calls.find(([method]) => method === 'revoke'), ['revoke', 'temporary-session', 'local'])
  assert.deepEqual(f.calls.find(([method]) => method === 'issue_account_deletion_proof')[1], { p_user_id: user.id, p_proof_hash: await hashProof(result.proof) })
})

test('wrong or replayed OTP and different verified user cannot issue a deletion proof', async () => {
  for (const opts of [{ otpError: { code: 'otp_expired' } }, { otpUser: { ...user, id: 'other' } }]) {
    const f = fixture(opts)
    assert.equal((await f.request({ action: 'verify', code: '12345678' })).status, 400)
    assert.equal(f.calls.some(([method]) => method === 'issue_account_deletion_proof'), false)
  }
})

test('expired proof requires reauthentication before Storage or Auth mutation', async () => {
  const f = fixture({ rpcError: { code: '28000' } })
  const res = await f.request({ action: 'delete', proof, confirmation: '削除する' })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'reauth_required')
  assert.equal(f.calls.some(([method]) => method === 'remove' || method === 'deleteUser'), false)
})

test('all photo batches are removed before deleting the exact authenticated user', async () => {
  const files = Array.from({ length: 205 }, (_, index) => ({ bucket_id: 'review-images', name: `reviews/${index}.jpg` }))
  files.push({ bucket_id: 'room-photos', name: 'room/a.jpg' })
  const f = fixture({ files, reviews: [{ id: '1', image_url: `${supabaseUrl}/storage/v1/object/public/review-images/reviews/1.jpg` }] })
  const res = await f.request({ action: 'delete', proof, confirmation: '削除する', userId: 'victim' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { deleted: true })
  const removals = f.calls.filter(([method]) => method === 'remove')
  assert.deepEqual(removals.map(([, , paths]) => paths.length), [100, 100, 5, 1])
  assert.ok(f.calls.findIndex(([method]) => method === 'deleteUser') > f.calls.findLastIndex(([method]) => method === 'remove'))
  assert.deepEqual(f.calls.find(([method]) => method === 'deleteUser'), ['deleteUser', user.id, false])
})

test('Storage failure keeps Auth and the deletion manifest available for retry', async () => {
  const f = fixture({ files: [{ bucket_id: 'review-images', name: 'reviews/a.jpg' }], storageError: new Error('Storage unavailable') })
  const res = await f.request({ action: 'delete', proof, confirmation: '削除する' })
  assert.equal(res.status, 503)
  assert.equal((await res.json()).code, 'deletion_pending')
  assert.equal(f.calls.some(([method]) => method === 'deleteUser'), false)
  assert.equal(f.calls.at(-1)[0], 'release_account_deletion_lease')
})

test('Auth deletion failure is retryable, and review photos are paginated', async () => {
  const f = fixture({ deleteError: new Error('db trigger failure'), reviews: Array.from({ length: 501 }, (_, index) => ({ id: String(index), image_url: null })) })
  assert.equal((await f.request({ action: 'delete', proof, confirmation: '削除する' })).status, 503)
  assert.deepEqual(f.calls.filter(([method]) => method === 'reviews'), [['reviews', 0, 499], ['reviews', 500, 999]])
  assert.equal(f.calls.at(-1)[0], 'release_account_deletion_lease')
})
