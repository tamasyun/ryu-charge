import { useEffect, useState } from 'react'
import { fetchReviews } from '../../services/reviews'

export default function ReviewList({ roomId }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    async function loadReviews() {
      setLoading(true)
      setErrorMessage('')
      try {
        const reviews = await fetchReviews(roomId)
        if (active) setReviews(reviews)
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : '読み込みに失敗しました。')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadReviews()
    return () => { active = false }
  }, [roomId])

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
            <time dateTime={review.created_at}>
              {new Date(review.created_at).toLocaleDateString('ja-JP')}
            </time>
          </div>
          <p>{review.comment}</p>
        </article>
      ))}
    </div>
  )
}

