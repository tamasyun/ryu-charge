import { publicPhotoPath } from '../utils/photoReferences.js'
import { rememberRecovery } from './photoUpload.js'
import { removePhotoObjects } from './photoRemoval.js'

export function createReviewDeleter(client, { recordRecovery = rememberRecovery, verifyAbsent } = {}) {
  return async function deleteReview(reviewId) {
    // RLSによる0件の削除を成功扱いにしない。応答不明の場合は画像に触れない。
    const { data, error } = await client.from('room_reviews').delete().eq('id', reviewId).select('id,image_url')
    if (error) throw error
    if (data?.length !== 1 || data[0].id !== reviewId) throw new Error('レビューを削除できませんでした。ログイン状態を確認してください。')
    const imageUrl = data[0].image_url
    if (!imageUrl) return { imageCleanupPending: false }
    const path = publicPhotoPath(imageUrl, client.supabaseUrl, 'review-images')
    // 旧データの外部URL・不正なパスを推測して削除しない。
    if (!path?.startsWith('reviews/')) return { imageCleanupPending: false }
    try {
      const references = await client.from('room_reviews').select('id').eq('image_url', imageUrl).limit(1)
      if (references.error) throw references.error
      if (!Array.isArray(references.data)) throw new Error('画像の参照を確認できませんでした。')
      if (references.data.length) return { imageCleanupPending: false }
      await removePhotoObjects(client, 'review-images', [path], { verifyAbsent })
      return { imageCleanupPending: false }
    } catch {
      recordRecovery({ id: crypto.randomUUID(), bucket: 'review-images', paths: [path], table: 'room_reviews', reason: 'review-deleted-cleanup-pending' })
      // レビュー自体の削除は成立している。再度削除・投稿させない。
      return { imageCleanupPending: true }
    }
  }
}
