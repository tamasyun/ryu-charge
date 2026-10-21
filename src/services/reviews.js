import { supabase } from '../lib/supabase'

export async function fetchReviews(roomId) {
  const { data, error } = await supabase
    .from('room_reviews')
    .select('id, rating, comment, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createReview({ roomId, rating, comment }) {
  const { error } = await supabase.from('room_reviews').insert({
    room_id: roomId,
    rating,
    comment,
  })
  if (error) throw error
}

export async function fetchReviewOverview(roomIds) {
  const byRoom = {}
  if (roomIds.length === 0) return byRoom

  // Supabase の取得件数制限を越えても、全レビューから集計する。
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
