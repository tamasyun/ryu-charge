import { useEffect, useState } from 'react'
import { fetchReviews, deleteReview } from '../../services/reviews'
import { supabase } from '../../lib/supabase'

export default function ReviewList({ roomId, onDeleted }) {
  const [reviews, setReviews] = useState([])
  const [currentUserId, setCurrentUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  // ログイン中のユーザーIDを取得
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data?.user?.id ?? null)
    })
  }, [])

  async function loadReviews() {
    setLoading(true)
    setErrorMessage('')
    try {
      const reviews = await fetchReviews(roomId)
      setReviews(reviews)
    } catch (error) {
      const msg = error?.message || (error instanceof Error ? error.message : '読み込みに失敗しました。')
      setErrorMessage(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReviews()
  }, [roomId])

  // 自分のレビューを削除する処理
  async function handleDelete(reviewId) {
    if (!window.confirm('このレビューを削除しますか？')) return

    try {
      await deleteReview(reviewId)
      await loadReviews() // 画面の一覧を更新
      onDeleted?.() // 親コンポーネントに削除を通知してボタンを復活させる
    } catch (error) {
      alert('削除に失敗しました: ' + (error?.message || 'エラー'))
    }
  }

  if (loading) return <p>レビューを読み込み中...</p>
  if (errorMessage) return <p className="review-error" role="alert">{errorMessage}</p>

  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : null

  return (
    <div className="review-list">
      <p className="review-summary">
        {average === null ? 'まだレビューはありません。' : `★ ${average.toFixed(1)} / 5（${reviews.length}件）`}
      </p>
      {reviews.map(review => (
        <article key={review.id} className="review-item">
          <div className="review-item-header">
            <span className="review-stars" aria-label={`${review.rating}つ星`}>
              {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <time dateTime={review.created_at}>
                {new Date(review.created_at).toLocaleDateString('ja-JP')}
              </time>
              {/* 自分の投稿の場合のみ削除ボタンを表示 */}
              {currentUserId && review.user_id === currentUserId && (
                <button
                  type="button"
                  onClick={() => handleDelete(review.id)}
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: '#ef4444',
                    fontSize: '11px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                >
                  削除
                </button>
              )}
            </div>
          </div>
          {review.comment && <p>{review.comment}</p>}

          {/* 写真があれば表示 */}
          {review.image_url && (
            <div style={{ marginTop: '8px' }}>
              <a href={review.image_url} target="_blank" rel="noopener noreferrer">
                <img
                  src={review.image_url}
                  alt="レビュー写真"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '180px',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    objectFit: 'cover',
                    display: 'block'
                  }}
                />
              </a>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}