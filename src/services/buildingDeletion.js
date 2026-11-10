import { publicPhotoPath } from '../utils/photoReferences.js'
import { rememberRecovery } from './photoUpload.js'
import { removePhotoObjects } from './photoRemoval.js'

export function createBuildingDeleters(client, { recordRecovery = rememberRecovery, verifyAbsent } = {}) {
  async function deleteOutlet(outletId) {
    const { data, error } = await client.from('outlets').delete().eq('id', outletId).select('id')
    if (error) throw error
    if (data?.length !== 1 || data[0].id !== outletId) {
      throw new Error('コンセントを削除できませんでした。ログイン状態と投稿者を確認してください。')
    }
  }

  async function cleanupPhoto(bucket, table, path, imageUrl) {
    try {
      // 別の投稿で同じ画像が使われている場合は残す。
      const columns = table === 'room_photos' ? [['storage_path', path], ['image_url', imageUrl]] : [['image_url', imageUrl]]
      for (const [column, value] of columns) {
        const { data, error } = await client.from(table).select('id').eq(column, value).limit(1)
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('写真の参照を確認できませんでした。')
        if (data.length) return false
      }
      await removePhotoObjects(client, bucket, [path], { verifyAbsent })
      return false
    } catch {
      recordRecovery({ id: crypto.randomUUID(), bucket, paths: [path], table, reason: 'room-deleted-cleanup-pending' })
      return true
    }
  }

  async function deleteRoom(roomId) {
    // 関連写真の一覧は、教室の削除と同じDBトランザクション内で確保する。
    const { data, error } = await client.rpc('delete_own_room', { p_room_id: roomId })
    if (error?.message?.includes('room_has_other_contributions')) {
      throw new Error('ほかの人の投稿や投稿者不明のコンセント・写真・レビューがあるため、この教室は削除できません。')
    }
    if (error) throw error
    if (data?.id !== roomId) throw new Error('教室を削除できませんでした。ログイン状態と投稿者を確認してください。')

    // 削除が確認できた後だけStorageに触れる。後処理の失敗で削除済み教室を復活させない。
    let imageCleanupPending = false
    const targets = new Map()
    for (const photo of data.room_photos ?? []) {
      const path = photo.storage_path
      const imageUrl = `${client.supabaseUrl}/storage/v1/object/public/room-photos/${path}`
      if (typeof path !== 'string' || !path.startsWith(`${roomId}/`) || publicPhotoPath(imageUrl, client.supabaseUrl, 'room-photos') !== path) continue
      targets.set(`room-photos/${path}`, { bucket: 'room-photos', table: 'room_photos', path, imageUrl })
    }
    for (const review of data.room_reviews ?? []) {
      const path = publicPhotoPath(review.image_url, client.supabaseUrl, 'review-images')
      if (!path?.startsWith('reviews/')) continue
      targets.set(`review-images/${path}`, { bucket: 'review-images', table: 'room_reviews', path, imageUrl: review.image_url })
    }
    for (const { bucket, table, path, imageUrl } of targets.values()) {
      const pending = await cleanupPhoto(bucket, table, path, imageUrl)
      imageCleanupPending ||= pending
    }
    return { imageCleanupPending }
  }

  return { deleteRoom, deleteOutlet }
}
