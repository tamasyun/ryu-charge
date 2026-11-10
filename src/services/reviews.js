import { appAuth, getDataClient } from '../lib/supabase'
import { fetchAuthorNames } from './profiles'
import { createPhotoUploader } from './photoUpload.js'
import { createReviewDeleter } from './reviewDeletion.js'
import { demoAccount } from '../demo/account.js'
import { prepareDemoPhotos } from '../demo/photos.js'

// レビュー一覧取得（image_url を追加）
export async function fetchReviews(roomId) {
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()
  const { data, error } = await client
    .from('room_reviews')
    .select('id, rating, comment, image_url, user_id, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  if (error) throw error
  const authorNames = await fetchAuthorNames((data ?? []).map(review => review.user_id), client)
  guard()
  const local = demo ? demoAccount.reviews(roomId) : []
  return [...local.reverse(), ...(data ?? []).map(review => ({ ...review, author_nickname: authorNames.get(review.user_id) }))]
}

// 写真付きレビューはアップロードからDB登録・失敗時の回収まで一括して扱う。
export async function createReview({ roomId, rating, comment, imageFile = null }) {
  if (demoAccount.isActive()) {
    const guard = demoAccount.capture()
    const image_url = imageFile ? (await prepareDemoPhotos([imageFile]))[0] : null
    guard()
    demoAccount.add('reviews', [{ room_id: roomId, rating, comment, image_url }])
    return
  }
  const client = getDataClient()
  if (imageFile) {
    await createPhotoUploader(client)({
      bucket: 'review-images', folder: 'reviews', files: [imageFile], table: 'room_reviews',
      makeRecord: (_path, imageUrl) => ({ room_id: roomId, rating, comment, image_url: imageUrl }),
    })
    return
  }
  const { error } = await client.from('room_reviews').insert({
    room_id: roomId, rating, comment, image_url: null,
  })
  if (error) throw error
}

export async function fetchReviewOverview(roomIds) {
  const byRoom = {}
  if (roomIds.length === 0) return byRoom
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()

  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
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

  guard()
  if (demo) {
    for (const review of demoAccount.rows('reviews').filter(row => roomIds.includes(row.room_id))) {
      const summary = byRoom[review.room_id] ?? { count: 0, ratingTotal: 0 }
      summary.count += 1
      summary.ratingTotal += review.rating
      byRoom[review.room_id] = summary
    }
  }

  return byRoom
}

// src/services/reviews.js の一番下に追加
export async function checkUserHasReviewed(roomId) {
  if (demoAccount.isActive()) return demoAccount.reviews(roomId).length > 0
  const { data: { user } } = await appAuth.getUser()
  if (!user) return false

  const { data, error } = await getDataClient()
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

export async function deleteReview(id) {
  if (demoAccount.isActive()) return demoAccount.removeReview(id)
  return createReviewDeleter(getDataClient())(id)
}
