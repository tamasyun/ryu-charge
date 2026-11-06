import { supabase } from '../lib/supabase'
import { fetchAuthorNames } from './profiles'

export async function createRoom(record) {
  const { error } = await supabase.from('rooms').insert(record)
  if (error) throw error
}

export async function createOutlet(record) {
  const { error } = await supabase.from('outlets').insert(record)
  if (error) throw error
}

export async function fetchBuildings() {
  const { data, error } = await supabase
    .from('buildings')
    .select(`
      id, name, latitude, longitude,
      rooms (
        id, name, floor, location_detail, user_id,
        outlets (id, location_detail, ac_ports, user_id)
      )
    `)
    .order('id')

  if (error) throw error

  const authorNames = await fetchAuthorNames((data ?? []).flatMap(building =>
    (building.rooms ?? []).flatMap(room => [room.user_id, ...(room.outlets ?? []).map(outlet => outlet.user_id)])
  ))

  return (data ?? []).map(building => ({
    ...building,
    rooms: (building.rooms ?? [])
      .map(room => ({
        ...room,
        author_nickname: authorNames.get(room.user_id),
        outlets: (room.outlets ?? []).map(outlet => ({
          ...outlet, author_nickname: authorNames.get(outlet.user_id),
        })),
      }))
      .sort((a, b) =>
        (a.floor ?? 0) - (b.floor ?? 0) || a.name.localeCompare(b.name, 'ja')
      ),
  }))
}


const ROOM_PHOTO_BUCKET = 'room-photos'
const MAX_PHOTO_SIZE = 5 * 1024 * 1024
const MAX_PHOTOS_PER_UPLOAD = 5

// 教室の写真を取得
export async function fetchRoomPhotos(roomIds) {
  if (!roomIds.length) return {}

  const { data, error } = await supabase
    .from('room_photos')
    .select('id, room_id, storage_path, user_id, created_at')
    .in('room_id', roomIds)
    .order('created_at', { ascending: true })

  if (error) throw error

  const authorNames = await fetchAuthorNames(
    [...new Set((data ?? []).map(photo => photo.user_id))]
  )

  const result = {}

  for (const photo of data ?? []) {
    const { data: urlData } = supabase.storage
      .from(ROOM_PHOTO_BUCKET)
      .getPublicUrl(photo.storage_path)

    if (!result[photo.room_id]) {
      result[photo.room_id] = []
    }

    result[photo.room_id].push({
      id: photo.id,
      url: urlData.publicUrl,
      author_nickname: authorNames.get(photo.user_id),
      created_at: photo.created_at,
    })
  }

  return result
}

// 教室の写真をアップロード
export async function uploadRoomPhotos(roomId, files) {
  if (!roomId || !files.length) return []

  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    throw new Error('一度に追加できる写真は5枚までです。')
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']

  for (const file of files) {
    if (!allowedTypes.includes(file.type)) {
      throw new Error('JPEG・PNG・WebP形式の画像を選択してください。')
    }

    if (file.size > MAX_PHOTO_SIZE) {
      throw new Error('写真は1枚5MB以下にしてください。')
    }
  }

  const uploadedPaths = []

  try {
    // 画像本体をStorageに保存
    for (const file of files) {
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }[file.type]

      const path = `${roomId}/${crypto.randomUUID()}.${extension}`

      const { error } = await supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        })

      if (error) throw error

      uploadedPaths.push(path)
    }

    // 写真の情報をDBに保存
    const records = uploadedPaths.map(path => ({
      room_id: roomId,
      storage_path: path,
    }))

    const { data, error } = await supabase
      .from('room_photos')
      .insert(records)
      .select('id, room_id, storage_path, user_id, created_at')

    if (error) throw error

    const authorNames = await fetchAuthorNames(
      [...new Set((data ?? []).map(photo => photo.user_id))]
    )

    return (data ?? []).map(photo => {
      const { data: urlData } = supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .getPublicUrl(photo.storage_path)

      return {
        id: photo.id,
        url: urlData.publicUrl,
        author_nickname: authorNames.get(photo.user_id),
        created_at: photo.created_at,
      }
    })
  } catch (error) {
    // DB登録に失敗した場合はアップロード済み画像を削除
    if (uploadedPaths.length) {
      await supabase.storage
        .from(ROOM_PHOTO_BUCKET)
        .remove(uploadedPaths)
    }

    throw error
  }
}
