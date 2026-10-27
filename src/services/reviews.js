import { supabase } from '../lib/supabase'

// 画像を Storage にアップロードして公開URLを取得する関数
export async function uploadReviewImage(file) {
  const fileExt = file.name.split('.').pop()
  const fileName = `${crypto.randomUUID()}.${fileExt}`
  const filePath = `reviews/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('review-images')
    .upload(filePath, file)

  if (uploadError) throw uploadError

  const { data } = supabase.storage
    .from('review-images')
    .getPublicUrl(filePath)

  return data.publicUrl
}

// レビュー一覧取得（image_url を追加）
export async function fetchReviews(roomId) {
  const { data, error } = await supabase
    .from('room_reviews')
    .select('id, rating, comment, image_url, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

// レビュー作成（imageUrl を含めて保存）
export async function createReview({ roomId, rating, comment, imageUrl = null }) {
  const { error } = await supabase.from('room_reviews').insert({
    room_id: roomId,
    rating,
    comment,
    image_url: imageUrl,
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