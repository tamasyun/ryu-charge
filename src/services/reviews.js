import { supabase } from '../lib/supabase'
import { fetchAuthorNames } from './profiles'
import { createPhotoUploader } from './photoUpload.js'
import { createReviewDeleter } from './reviewDeletion.js'

const uploadPhotos = createPhotoUploader(supabase)

// レビュー一覧取得（image_url を追加）
export async function fetchReviews(roomId) {
  const { data, error } = await supabase
    .from('room_reviews')
    .select('id, rating, comment, image_url, user_id, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  if (error) throw error
  const authorNames = await fetchAuthorNames((data ?? []).map(review => review.user_id))
  return (data ?? []).map(review => ({ ...review, author_nickname: authorNames.get(review.user_id) }))
}

// 写真付きレビューはアップロードからDB登録・失敗時の回収まで一括して扱う。
export async function createReview({ roomId, rating, comment, imageFile = null }) {
  if (imageFile) {
    await uploadPhotos({
      bucket: 'review-images', folder: 'reviews', files: [imageFile], table: 'room_reviews',
      makeRecord: (_path, imageUrl) => ({ room_id: roomId, rating, comment, image_url: imageUrl }),
    })
    return
  }
  const { error } = await supabase.from('room_reviews').insert({
    room_id: roomId, rating, comment, image_url: null,
  })
  if (error) throw error
}

export async function fetchReviewOverview(roomIds) {
  const byRoom = {}
  if (roomIds.length === 0) return byRoom

  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('room_reviews')
      .select('room_id, rating')
      .in('room_id', roomIds)
      .order('id')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    const reviews = data ?? []
    for (const review of reviews) {
      const summary = byRoom[review.room_id] ?? { count: 0, ratingTotal: 0 }
      summary.count += 1
      summary.ratingTotal += review.rating
      byRoom[review.room_id] = summary
    }
    if (reviews.length < pageSize) break
  }

  return byRoom
}

// src/services/reviews.js の一番下に追加
export async function checkUserHasReviewed(roomId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data, error } = await supabase
    .from('room_reviews')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('投稿確認エラー:', error)
    return false
  }

  return Boolean(data) // 既にレビューがあれば true、なければ false
}

export const deleteReview = createReviewDeleter(supabase)
