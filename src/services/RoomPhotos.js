import { supabase } from '../lib/supabase'

const ROOM_PHOTO_BUCKET = 'room-photos'
const MAX_PHOTO_SIZE = 5 * 1024 * 1024
const MAX_PHOTOS_PER_UPLOAD = 5
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function extensionForType(type) {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  throw new Error('JPEG・PNG・WebP形式の写真を選択してください。')
}

export async function fetchRoomPhotos(roomIds) {
  if (!roomIds?.length) return {}

  const { data, error } = await supabase
    .from('room_photos')
    .select('id, room_id, image_url, storage_path, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).reduce((result, photo) => {
    // image_url未設定の既存レコードはstorage_pathからURLを補完する。
    const imageUrl = photo.image_url || (
      photo.storage_path
        ? supabase.storage.from(ROOM_PHOTO_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl
        : null
    )
    if (!imageUrl) return result

    if (!result[photo.room_id]) result[photo.room_id] = []
    result[photo.room_id].push({ ...photo, image_url: imageUrl })
    return result
  }, {})
}

export async function uploadRoomPhotos(roomId, files) {
  if (!roomId) throw new Error('教室を特定できませんでした。')
  if (!Array.isArray(files) || files.length === 0) return []
  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    throw new Error(`一度に追加できる写真は${MAX_PHOTOS_PER_UPLOAD}枚までです。`)
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error(`${file.name}：JPEG・PNG・WebP形式の写真を選択してください。`)
    }
    if (file.size > MAX_PHOTO_SIZE) {
      throw new Error(`${file.name}：写真のサイズは5MB以下にしてください（現在 ${(file.size / 1024 / 1024).toFixed(2)}MB）。`)
    }
  }

  const uploadedPaths = []
  const records = []

  try {
    for (const file of files) {
      const extension = extensionForType(file.type)
      const storagePath = `${roomId}/${crypto.randomUUID()}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        })

      if (uploadError) throw uploadError
      uploadedPaths.push(storagePath)

      const { data: publicUrlData } = supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .getPublicUrl(storagePath)

      records.push({
        room_id: roomId,
        storage_path: storagePath,
        image_url: publicUrlData.publicUrl,
      })
    }

    const { data, error: insertError } = await supabase
      .from('room_photos')
      .insert(records)
      .select('id, room_id, image_url, storage_path, created_at')

    if (insertError) throw insertError
    return data ?? []
  } catch (error) {
    // DB登録に失敗した場合、今回アップロードしたファイルをStorageから戻す。
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .remove(uploadedPaths)
      if (cleanupError) {
        console.error('写真ファイルの後片付けに失敗しました:', cleanupError)
      }
    }
    throw error
  }
}
