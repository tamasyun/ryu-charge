import assert from 'node:assert/strict'
import test from 'node:test'
import { createReviewDeleter } from '../src/services/reviewDeletion.js'
import { publicPhotoPath } from '../src/utils/photoReferences.js'

const base = 'https://abcdefghijklmnopqrst.supabase.co'
const url = `${base}/storage/v1/object/public/review-images/reviews/own.webp`
function fixture({ rows = [{ id: 'review', image_url: url }], deleteError, references = [], referenceError, removeError, emptyRemove = false } = {}) {
  const removed = [], recovery = []
  const client = {
    supabaseUrl: base,
    from(table) {
      assert.equal(table, 'room_reviews')
      return {
        delete() { return { eq(column, id) {
          assert.equal(column, 'id'); assert.equal(id, 'review')
          return { async select(columns) { assert.equal(columns, 'id,image_url'); return { data: rows, error: deleteError } } }
        } } },
        select(columns) {
          assert.equal(columns, 'id')
          return { eq(column, value) {
            assert.equal(column, 'image_url'); assert.equal(value, url)
            return { async limit(n) { assert.equal(n, 1); return { data: references, error: referenceError } } }
          } }
        },
      }
    },
    storage: { from(bucket) { assert.equal(bucket, 'review-images'); return {
      async remove(paths) { removed.push(...paths); return { data: emptyRemove ? [] : paths.map(name => ({ name })), error: removeError } },
      getPublicUrl() { return { data: { publicUrl: url } } },
    } } },
  }
  return { removed, recovery, run: () => createReviewDeleter(client, { recordRecovery: entry => recovery.push(entry), verifyAbsent: async value => assert.equal(value, url) })('review') }
}
test('confirmed own review deletion cleans its image through the Storage API', async () => {
  const f = fixture()
  assert.deepEqual(await f.run(), { imageCleanupPending: false })
  assert.deepEqual(f.removed, ['reviews/own.webp'])
})
for (const config of [{ rows: [] }, { deleteError: new Error('offline') }]) {
  test('denied or uncertain review deletion never touches the image', async () => {
    const f = fixture(config)
    await assert.rejects(f.run())
    assert.equal(f.removed.length, 0)
  })
}
test('shared review image is preserved', async () => {
  const f = fixture({ references: [{ id: 'another' }] })
  assert.equal((await f.run()).imageCleanupPending, false)
  assert.equal(f.removed.length, 0)
})
for (const config of [{ emptyRemove: true }, { removeError: new Error('RLS') }, { referenceError: new Error('offline') }]) {
  test('cleanup failure does not reverse confirmed review deletion and is recorded', async () => {
    const f = fixture(config)
    assert.equal((await f.run()).imageCleanupPending, true)
    assert.equal(f.recovery[0].reason, 'review-deleted-cleanup-pending')
    assert.deepEqual(f.recovery[0].paths, ['reviews/own.webp'])
  })
}
test('external/legacy image URL is not interpreted as a deletion target', async () => {
  const f = fixture({ rows: [{ id: 'review', image_url: 'https://foreign.example/reviews/own.webp' }] })
  assert.equal((await f.run()).imageCleanupPending, false)
  assert.equal(f.removed.length, 0)
})
test('public URL parser is project/bucket limited and handles encoded names safely', () => {
  assert.equal(publicPhotoPath(url.replace('own.webp', '%E5%86%99%E7%9C%9F%20a.webp'), base, 'review-images'), 'reviews/写真 a.webp')
  for (const value of [url.replace('abcdefghijklmnopqrst', 'other'), url.replace('review-images', 'room-photos'), `${url}?x=1`, url.replace('own.webp', '%00.webp'), url.replace('own.webp', '%2e%2e%2fsecret'), 'invalid']) {
    assert.equal(publicPhotoPath(value, base, 'review-images'), null)
  }
})
