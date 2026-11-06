import assert from 'node:assert/strict'
import test from 'node:test'
import { createPhotoUploader } from '../src/services/photoUpload.js'

function fixture({ conversionError, uploadAt = -1, databaseError, cleanupError, cleanupEmpty = false, afterCommit = false, incomplete = false, absenceError } = {}) {
  const files = Array.from({ length: 5 }, () => new File(['encoded'], 'photo.webp', { type: 'image/webp' }))
  const uploaded = [], removed = [], batches = [], recovery = [], progress = []
  let count = 0
  const client = {
    storage: { from(bucket) {
      assert.equal(bucket, 'room-photos')
      return {
        async upload(path, file, options) {
          assert.equal(file.type, options.contentType)
          assert.match(path, /^room-1\/[\w-]+\.webp$/)
          uploaded.push(path)
          return { error: count++ === uploadAt ? new Error('offline') : null }
        },
        getPublicUrl(path) { return { data: { publicUrl: `https://example.test/${path}` } } },
        async remove(paths) { removed.push(...paths); return { data: cleanupEmpty ? [] : paths.map(name => ({ name })), error: cleanupError } },
      }
    } },
    from(table) {
      assert.equal(table, 'room_photos')
      return { insert(records) {
        batches.push(records)
        return { async select(columns) {
          assert.equal(columns, 'id,room_id,storage_path,image_url,user_id,created_at')
          if (afterCommit) throw new Error('connection lost after commit')
          return { data: (incomplete ? records.slice(1) : [...records].reverse()).map((record, id) => ({ ...record, id })), error: databaseError }
        } }
      } }
    },
  }
  const upload = createPhotoUploader(client, {
    prepare: async input => { assert.equal(input, files); if (conversionError) throw conversionError; return files },
    recordRecovery: entry => recovery.push(entry), track: () => {},
    verifyAbsent: async url => { assert.ok(uploaded.some(path => url.endsWith(path))); if (absenceError) throw absenceError },
  })
  return { uploaded, removed, batches, recovery, progress,
    run: () => upload({ bucket: 'room-photos', folder: 'room-1', files, table: 'room_photos',
      makeRecord: (storage_path, image_url) => ({ room_id: 'room-1', storage_path, image_url }),
      onProgress: value => progress.push(value),
    }),
  }
}

test('five photos use a single atomic DB insert, matching content types and selection order', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.length, 5)
  assert.deepEqual(result.map(row => row.storage_path), f.uploaded)
  assert.equal(f.batches.length, 1)
  assert.equal(f.batches[0].length, 5)
  assert.equal(f.removed.length, 0)
  assert.equal(f.progress.at(-1).phase, 'saving')
})
test('conversion failure changes neither storage nor DB', async () => {
  const f = fixture({ conversionError: new Error('bad HEIC') })
  await assert.rejects(f.run(), /bad HEIC/)
  assert.equal(f.uploaded.length, 0)
  assert.equal(f.batches.length, 0)
})
test('upload failure recovers all attempted paths, including a lost upload response', async () => {
  const f = fixture({ uploadAt: 2 })
  await assert.rejects(f.run(), /offline/)
  assert.deepEqual(f.removed, f.uploaded)
  assert.equal(f.removed.length, 3)
  assert.equal(f.batches.length, 0)
})
test('definitive DB rejection recovers the batch', async () => {
  const f = fixture({ databaseError: { code: '42501', message: 'RLS denied' } })
  await assert.rejects(f.run())
  assert.equal(f.removed.length, 5)
})
test('DB response lost after commit never deletes potentially referenced images', async () => {
  const f = fixture({ afterCommit: true })
  await assert.rejects(f.run(), /保存結果/)
  assert.equal(f.removed.length, 0)
  assert.equal(f.recovery[0].reason, 'database-result-unknown')
})
test('incomplete successful DB response is preserved for reconciliation, not silently accepted or deleted', async () => {
  const f = fixture({ incomplete: true })
  await assert.rejects(f.run(), /保存結果/)
  assert.equal(f.removed.length, 0)
  assert.equal(f.recovery[0].reason, 'database-result-unknown')
})
for (const failure of [{ cleanupError: new Error('RLS') }, { cleanupEmpty: true }, { absenceError: new Error('still exists') }]) {
  test(`cleanup ${failure.cleanupEmpty ? 'empty response' : 'failure'} is reported and journaled`, async () => {
    const f = fixture({ databaseError: { code: '23505' }, ...failure })
    await assert.rejects(f.run(), /回収/)
    assert.equal(f.recovery[0].paths.length, 5)
  })
}

test('review image remains in review-images/reviews and is recovered on SQL rejection', async () => {
  const files = [new File(['processed'], 'photo.png', { type: 'image/png' })]
  let uploaded, removed, record
  const client = {
    storage: { from(bucket) {
      assert.equal(bucket, 'review-images')
      return {
        async upload(path, file, options) { uploaded = path; assert.equal(options.contentType, file.type); return {} },
        getPublicUrl(path) { return { data: { publicUrl: `https://example.test/${path}` } } },
        async remove(paths) { removed = paths; return { data: paths.map(name => ({ name })) } },
      }
    } },
    from(table) { assert.equal(table, 'room_reviews'); return { insert(records) {
      assert.equal(records.length, 1); record = records[0]
      return { async select(columns) {
        assert.equal(columns, 'id,room_id,rating,comment,image_url,user_id,created_at')
        assert.ok(!columns.includes('delete_key_hash'))
        return { error: { code: '23505', message: 'review exists' } }
      } }
    } } },
  }
  const upload = createPhotoUploader(client, { prepare: async () => files, track: () => {}, verifyAbsent: async () => {} })
  await assert.rejects(upload({ bucket: 'review-images', folder: 'reviews', table: 'room_reviews', files,
    makeRecord: (_path, image_url) => ({ room_id: 'room-1', rating: 4, comment: null, image_url }),
  }))
  assert.match(uploaded, /^reviews\/[\w-]+\.png$/)
  assert.deepEqual(removed, [uploaded])
  assert.equal(record.image_url, `https://example.test/${uploaded}`)
})

test('batch selection order survives a reload without moving existing photos', async () => {
  const { orderPhotoBatches } = await import('../src/utils/photoOrder.js')
  const prefix = '101/550e8400-e29b-41d4-a716-446655440000'
  const photos = [
    { id: 'legacy-1', storage_path: '101/old.jpg', created_at: 'old' },
    { id: 'third', storage_path: `${prefix}-03.webp`, created_at: 'new' },
    { id: 'legacy-2', storage_path: '101/existing.png', created_at: 'new' },
    { id: 'first', storage_path: `${prefix}-01.webp`, created_at: 'new' },
    { id: 'second', storage_path: `${prefix}-02.webp`, created_at: 'new' },
  ]
  assert.deepEqual(orderPhotoBatches(photos).map(photo => photo.id), ['legacy-1', 'first', 'legacy-2', 'second', 'third'])
  assert.equal(photos[1].id, 'third')
})
