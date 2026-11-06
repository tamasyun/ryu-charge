import assert from 'node:assert/strict'
import test from 'node:test'
import { removePhotoObjects, verifyPublicPhotoAbsent } from '../src/services/photoRemoval.js'

const base = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/review-images/reviews/test.webp'
function clientWith(data, error) {
  return { storage: { from(bucket) {
    assert.equal(bucket, 'review-images')
    return { remove: async () => ({ data, error }), getPublicUrl: () => ({ data: { publicUrl: base } }) }
  } } }
}
test('removal validates exact paths/count and then checks public absence', async () => {
  const checked = []
  await removePhotoObjects(clientWith([{ name: 'reviews/test.webp' }]), 'review-images', ['reviews/test.webp'], { verifyAbsent: async url => checked.push(url) })
  assert.deepEqual(checked, [base])
})
for (const data of [[], [{ name: 'other.webp' }], [{ name: 'reviews/test.webp' }, { name: 'reviews/test.webp' }], [{ name: 'reviews/test.webp' }, { name: 'extra.webp' }]]) {
  test('empty, duplicate, extra or wrong-path removal results never confirm success', async () => {
    let checked = false
    await assert.rejects(removePhotoObjects(clientWith(data), 'review-images', ['reviews/test.webp'], { verifyAbsent: async () => { checked = true } }), /件数/)
    assert.equal(checked, false)
  })
}
test('Storage errors and absence-check failures propagate for recovery journaling', async () => {
  await assert.rejects(removePhotoObjects(clientWith(null, new Error('denied')), 'review-images', ['reviews/test.webp']), /denied/)
  await assert.rejects(removePhotoObjects(clientWith([{ name: 'reviews/test.webp' }]), 'review-images', ['reviews/test.webp'], { verifyAbsent: async () => { throw new Error('still exists') } }), /still exists/)
})
for (const status of [404, 400]) {
  test(`explicit ${status} Not Found confirms absence with cache bypass and no credentials`, async () => {
    await verifyPublicPhotoAbsent(base, { fetchImpl: async (url, options) => {
      assert.ok(new URL(url).searchParams.get('cacheNonce'))
      assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.Range, 'bytes=0-0')
      return { status, json: async () => ({ statusCode: '404', message: 'Object not found' }) }
    } })
  })
}
for (const status of [200, 206, 400, 401, 403, 500]) {
  test(`HTTP ${status} without explicit Not Found does not prove absence`, async () => {
    await assert.rejects(verifyPublicPhotoAbsent(base, { fetchImpl: async () => ({ status, ok: status < 300, json: async () => ({ statusCode: 403, message: 'Unauthorized' }) }) }))
  })
}
test('network failure does not prove absence', async () => {
  await assert.rejects(verifyPublicPhotoAbsent(base, { fetchImpl: async () => { throw new Error('offline') } }), /offline/)
})
