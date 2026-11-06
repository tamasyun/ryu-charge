import { publicPhotoPath } from '../src/utils/photoReferences.js'
import { argumentsFor, isMain, printReport, readOnlyQuery, readSnapshot } from './lib/read-only.mjs'

const BUCKETS = ['review-images', 'room-photos']
export const SNAPSHOT_QUERY = `SELECT jsonb_build_object(
  'schemaVersion', 1, 'capturedAt', now(),
  'objects', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'bucket_id', bucket_id, 'name', name, 'owner_id', owner_id,
    'created_at', created_at, 'updated_at', updated_at,
    'size', metadata->>'size', 'mimetype', metadata->>'mimetype') ORDER BY bucket_id, name), '[]'::jsonb)
    FROM storage.objects WHERE bucket_id IN ('review-images','room-photos')),
  'reviews', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'image_url', image_url)), '[]'::jsonb) FROM public.room_reviews),
  'room_photos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'room_id', room_id, 'storage_path', storage_path, 'image_url', image_url)), '[]'::jsonb) FROM public.room_photos)
) AS snapshot;`

export function auditPhotos(snapshot) {
  if (snapshot.schemaVersion !== 1 || !/^[a-z0-9]{20}$/.test(snapshot.projectRef || '') ||
      snapshot.supabaseUrl !== `https://${snapshot.projectRef}.supabase.co`) throw new Error('監査元プロジェクトを確認できません。')
  for (const key of ['objects', 'reviews', 'room_photos']) {
    if (!Array.isArray(snapshot[key])) throw new Error(`${key}が未取得です。不完全なデータで候補を出すことはできません。`)
  }
  const refs = new Map(), issues = [], keyFor = (bucket, path) => `${bucket}/${path}`
  function reference(bucket, path, record) {
    if (!path || typeof path !== 'string' || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.split('/').some(p => !p || p === '.' || p === '..')) {
      issues.push({ record, reason: 'invalid-storage-path' }); return
    }
    const key = keyFor(bucket, path)
    refs.set(key, [...(refs.get(key) || []), record])
  }
  function urlReference(bucket, value, record) {
    if (value == null) return null
    const path = publicPhotoPath(value, snapshot.supabaseUrl, bucket)
    if (!path) issues.push({ record, reason: 'unrecognized-image-url' })
    else reference(bucket, path, record)
    return path
  }
  for (const row of snapshot.reviews) {
    if (!row.id || !Object.hasOwn(row, 'image_url')) throw new Error('レビュー参照データが不完全です。')
    urlReference('review-images', row.image_url, `room_reviews:${row.id}`)
  }
  for (const row of snapshot.room_photos) {
    if (!row.id || !row.room_id || !Object.hasOwn(row, 'storage_path') || !Object.hasOwn(row, 'image_url')) throw new Error('教室写真参照データが不完全です。')
    const record = `room_photos:${row.id}`
    reference('room-photos', row.storage_path, record)
    const urlPath = urlReference('room-photos', row.image_url, record)
    if ((urlPath && urlPath !== row.storage_path) || !row.storage_path?.startsWith(`${row.room_id}/`)) issues.push({ record, reason: 'room-path-url-mismatch' })
  }
  const seen = new Set()
  const objects = snapshot.objects.map(object => {
    const key = keyFor(object.bucket_id, object.name)
    if (!BUCKETS.includes(object.bucket_id) || !object.id || !object.name || !object.updated_at || seen.has(key)) throw new Error('Storage一覧が不完全・重複しています。')
    seen.add(key)
    const references = refs.get(key) || []
    return { ...object, references, status: references.length ? 'referenced' : 'unreferenced' }
  })
  for (const [key, records] of refs) if (!seen.has(key)) issues.push({ key, records, reason: 'referenced-object-missing' })
  const unreferenced = objects.filter(object => object.status === 'unreferenced')
  return {
    mode: 'dry-run', projectRef: snapshot.projectRef, generatedAt: new Date().toISOString(), capturedAt: snapshot.capturedAt ?? null,
    notice: '削除は行いません。候補は削除許可ではありません。削除前に再監査し、ID・更新日時・DB参照と所有者を管理者が確認してください。',
    counts: { objects: objects.length, referenced: objects.length - unreferenced.length, unreferenced: unreferenced.length },
    complete: issues.length === 0, issues,
    // 参照データの異常時には候補として確定しない。
    candidates: issues.length ? [] : unreferenced,
    objects,
  }
}

if (isMain(import.meta.url)) {
  try {
    const args = argumentsFor(`写真の未参照候補を列挙するだけの管理者用dry-runです。削除機能はありません。
node scripts/audit-photo-storage.mjs --snapshot FILE [--output NEW_FILE]
SUPABASE_ACCESS_TOKENを設定後:
node scripts/audit-photo-storage.mjs --live --project-ref REF [--output NEW_FILE]
スナップショット形式: {schemaVersion:1, projectRef, supabaseUrl, capturedAt, objects:[], reviews:[], room_photos:[]}。
objectsはstorage.objectsのid,bucket_id,name,owner_id,created_at,updated_at,size,mimetype、
reviewsはid,image_url、room_photosはid,room_id,storage_path,image_urlをすべて取得してください。
出力には所有者IDや画像パスが含まれます。artifacts.local/等のGit対象外に保存してください。`)
    if (args) {
      const projectRef = args['project-ref']
      const snapshot = args.snapshot ? await readSnapshot(args.snapshot) : {
        ...(await readOnlyQuery(projectRef, SNAPSHOT_QUERY))[0]?.snapshot,
        projectRef, supabaseUrl: `https://${projectRef}.supabase.co`,
      }
      const report = auditPhotos(snapshot)
      await printReport(report, args.output)
      if (!report.complete) process.exitCode = 2
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
