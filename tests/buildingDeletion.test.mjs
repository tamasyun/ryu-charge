import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuildingDeleters } from '../src/services/buildingDeletion.js'

const base = 'https://abcdefghijklmnopqrst.supabase.co'
const photoUrl = (bucket, path) => `${base}/storage/v1/object/public/${bucket}/${path}`

function fixture({ deleted, error, outletRows = [{ id: 'outlet' }], shared = false, removeError, referenceError, emptyRemove = false } = {}) {
  const removed = [], recovery = [], calls = []
  const manifest = {
    id: 'room', room_photos: [{ storage_path: 'room/own.webp' }],
    room_reviews: [{ image_url: photoUrl('review-images', 'reviews/own.webp') }],
  }
  const client = {
    supabaseUrl: base,
    async rpc(name, args) {
      assert.equal(name, 'delete_own_room')
      assert.deepEqual(args, { p_room_id: 'room' })
      calls.push('delete')
      return { data: deleted === undefined ? manifest : deleted, error }
    },
    from(table) {
      return {
        delete() {
          assert.equal(table, 'outlets')
          return { eq(column, value) {
            assert.equal(column, 'id'); assert.equal(value, 'outlet')
            return { async select(columns) { assert.equal(columns, 'id'); return { data: outletRows, error } } }
          } }
        },
        select(columns) {
          assert.equal(columns, 'id')
          return { eq(column, value) {
            calls.push({ table, column, value })
            return { async limit(n) { assert.equal(n, 1); return { data: shared ? [{ id: 'shared' }] : [], error: referenceError } } }
          } }
        },
      }
    },
    storage: { from(bucket) { return {
      async remove(paths) {
        assert.equal(calls[0], 'delete')
        removed.push({ bucket, paths })
        return { data: emptyRemove ? [] : paths.map(name => ({ name })), error: removeError }
      },
      getPublicUrl(path) { return { data: { publicUrl: photoUrl(bucket, path) } } },
    } } },
  }
  return {
    ...createBuildingDeleters(client, { recordRecovery: entry => recovery.push(entry), verifyAbsent: async () => {} }),
    removed, recovery, calls,
  }
}

test('own outlet deletion succeeds only when exactly one record is returned', async () => {
  await fixture().deleteOutlet('outlet')
  for (const config of [{ outletRows: [] }, { outletRows: [{ id: 'wrong' }] }, { error: new Error('offline') }]) {
    await assert.rejects(fixture(config).deleteOutlet('outlet'))
  }
})

test('room deletion cleans both buckets after confirmed deletion and checks remaining references', async () => {
  const f = fixture()
  assert.deepEqual(await f.deleteRoom('room'), { imageCleanupPending: false })
  assert.deepEqual(f.removed, [
    { bucket: 'room-photos', paths: ['room/own.webp'] },
    { bucket: 'review-images', paths: ['reviews/own.webp'] },
  ])
  assert.deepEqual(f.calls.slice(1).map(call => call.column), ['storage_path', 'image_url', 'image_url'])
})

test('denied, absent or uncertain deletion never removes any photos', async () => {
  for (const config of [{ deleted: null }, { deleted: { id: 'other' } }, { error: new Error('offline') }]) {
    const f = fixture(config)
    await assert.rejects(f.deleteRoom('room'))
    assert.equal(f.removed.length, 0)
    assert.equal(f.calls.length, 1)
  }
  const f = fixture({ error: { message: 'room_has_other_contributions', code: '23503' } })
  await assert.rejects(f.deleteRoom('room'), /ほかの人の投稿/)
})

test('shared photos are preserved', async () => {
  const f = fixture({ shared: true })
  assert.deepEqual(await f.deleteRoom('room'), { imageCleanupPending: false })
  assert.equal(f.removed.length, 0)
})

test('Storage errors and reference failures keep the successful room deletion and record recovery', async () => {
  for (const config of [{ removeError: new Error('RLS') }, { referenceError: new Error('offline') }, { emptyRemove: true }]) {
    const f = fixture(config)
    assert.deepEqual(await f.deleteRoom('room'), { imageCleanupPending: true })
    assert.equal(f.recovery.length, 2)
    assert.ok(f.recovery.every(entry => entry.reason === 'room-deleted-cleanup-pending'))
  }
})

test('invalid or unrelated photo paths are never passed to Storage, duplicate references are cleaned once', async () => {
  const f = fixture({ deleted: {
    id: 'room', room_photos: [
      { storage_path: 'room/own.webp' }, { storage_path: 'room/own.webp' },
      ...['other/own.webp', 'room/../secret', 'room/%2e%2e/secret', 'room/a?x=1', 'room/a#hash'].map(storage_path => ({ storage_path })),
    ], room_reviews: [
      { image_url: 'https://foreign.example/reviews/photo.webp' },
      { image_url: photoUrl('review-images', 'other/photo.webp') },
    ],
  } })
  assert.deepEqual(await f.deleteRoom('room'), { imageCleanupPending: false })
  assert.deepEqual(f.removed, [{ bucket: 'room-photos', paths: ['room/own.webp'] }])
})
