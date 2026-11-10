import { getDataClient } from '../lib/supabase'
import { createPhotoUploader } from './photoUpload.js'
import { orderPhotoBatches } from '../utils/photoOrder.js'
import { demoAccount } from '../demo/account.js'
import { prepareDemoPhotos } from '../demo/photos.js'

const ROOM_PHOTO_BUCKET = 'room-photos'

export async function fetchRoomPhotos(roomIds) {
  if (!roomIds?.length) return {}
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()

  const { data, error } = await client
    .from('room_photos')
    .select('id, room_id, image_url, storage_path, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: true })

  if (error) throw error
  guard()
  const local = demo ? demoAccount.rows('photos').filter(photo => roomIds.includes(photo.room_id)) : []

  return orderPhotoBatches([...(data ?? []), ...local]).reduce((result, photo) => {
    // 常にstorage_pathと同じオブジェクトの公開URLを使用する。
    const imageUrl = (
      photo.storage_path
        ? client.storage.from(ROOM_PHOTO_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl
        : photo.image_url
    )
    if (!imageUrl) return result

    if (!result[photo.room_id]) result[photo.room_id] = []
    result[photo.room_id].push({ ...photo, image_url: imageUrl })
    return result
  }, {})
}

export async function uploadRoomPhotos(roomId, files, onProgress) {
  if (!roomId) throw new Error('教室を特定できませんでした。')
  if (!Array.isArray(files) || files.length === 0) return []
  if (files.length > 5) throw new Error('一度に追加できる写真は5枚までです。')
  if (demoAccount.isActive()) {
    const guard = demoAccount.capture()
    const urls = await prepareDemoPhotos(files, onProgress)
    guard()
    onProgress?.({ phase: 'saving', current: files.length, total: files.length })
    return demoAccount.add('photos', urls.map(image_url => ({ room_id: roomId, image_url, storage_path: null })))
  }

  const photos = await createPhotoUploader(getDataClient())({
    bucket: ROOM_PHOTO_BUCKET, folder: roomId, files, table: 'room_photos', onProgress,
    makeRecord: (storagePath, imageUrl) => ({ room_id: roomId, storage_path: storagePath, image_url: imageUrl }),
  })
  // DBの返却順ではなく、選択してアップロードした順に表示する。
  return photos
}
