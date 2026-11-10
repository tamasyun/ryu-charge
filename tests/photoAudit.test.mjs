import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { auditPhotos, SNAPSHOT_QUERY } from '../scripts/audit-photo-storage.mjs'
import { readOnlyQuery } from '../scripts/lib/read-only.mjs'

const projectRef = 'abcdefghijklmnopqrst', supabaseUrl = `https://${projectRef}.supabase.co`
const photoUrl = (bucket, name) => `${supabaseUrl}/storage/v1/object/public/${bucket}/${name}`
const object = (bucket_id, name) => ({ id: name, bucket_id, name, owner_id: 'owner', updated_at: '2026-11-07', size: '123' })
function snapshot() {
  return { schemaVersion: 1, projectRef, supabaseUrl,
    objects: [object('review-images', 'reviews/used.webp'), object('review-images', 'reviews/orphan.HEIC'), object('room-photos', 'room-1/used.jpg')],
    reviews: [{ id: 'r1', image_url: photoUrl('review-images', 'reviews/used.webp') }],
    room_photos: [{ id: 'p1', room_id: 'room-1', storage_path: 'room-1/used.jpg', image_url: null }],
  }
}
test('dry-run lists only unreferenced objects, preserving legacy and both reference sources', () => {
  const input = snapshot(), before = JSON.stringify(input), result = auditPhotos(input)
  assert.deepEqual(result.counts, { objects: 3, referenced: 2, unreferenced: 1 })
  assert.equal(result.candidates[0].name, 'reviews/orphan.HEIC')
  assert.equal(result.mode, 'dry-run')
  assert.equal(JSON.stringify(input), before)
})
test('missing tables and malformed snapshots fail closed', () => {
  for (const key of ['objects', 'reviews', 'room_photos']) {
    const input = snapshot(); delete input[key]
    assert.throws(() => auditPhotos(input), /未取得/)
  }
  const input = snapshot(); delete input.reviews[0].image_url
  assert.throws(() => auditPhotos(input), /不完全/)
})
test('mismatched room path and URL protect both objects and withhold all candidates', () => {
  const input = snapshot()
  input.objects.push(object('room-photos', 'room-1/other.webp'))
  input.room_photos[0].image_url = photoUrl('room-photos', 'room-1/other.webp')
  const result = auditPhotos(input)
  assert.equal(result.counts.referenced, 3)
  assert.equal(result.complete, false)
  assert.deepEqual(result.candidates, [])
})
test('unknown or missing referenced objects prevent candidate confirmation', () => {
  for (const image_url of ['https://foreign.example/image.webp', photoUrl('review-images', 'reviews/missing.webp')]) {
    const input = snapshot(); input.reviews[0].image_url = image_url
    const result = auditPhotos(input)
    assert.equal(result.complete, false); assert.equal(result.candidates.length, 0)
  }
})
test('encoded public URL references are recognized', () => {
  const input = snapshot()
  input.objects[0].name = 'reviews/写真 a.webp'
  input.reviews[0].image_url = photoUrl('review-images', 'reviews/%E5%86%99%E7%9C%9F%20a.webp')
  assert.equal(auditPhotos(input).counts.referenced, 2)
})
test('live audit uses only the dedicated read-only endpoint; SQL returns complete aggregate snapshots', async () => {
  assert.match(SNAPSHOT_QUERY, /jsonb_agg/)
  assert.doesNotMatch(SNAPSHOT_QUERY, /\b(INSERT|UPDATE|DELETE|LIMIT)\b/i)
  const result = await readOnlyQuery(projectRef, 'SELECT 1', { token: 'test-token', fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`)
    assert.deepEqual(JSON.parse(options.body), { query: 'SELECT 1' })
    assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => [{ n: 1 }] }
  } })
  assert.deepEqual(result, [{ n: 1 }])
  await assert.rejects(readOnlyQuery(projectRef, 'SELECT 1', { token: 'secret', fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
})
test('delete flags are unsupported; audit does not provide a mutation mode', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-photo-storage.mjs', '--delete'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unknown option/)
})
