import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './RoomReviews.css'

function ReviewForm({ roomId, onSubmitted }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const message = comment.trim()
    if (saving || rating < 1 || rating > 5 || !message || message.length > 500) return

    setSaving(true)
    setErrorMessage('')
    try {
      const { error } = await supabase.from('room_reviews').insert({
        room_id: roomId,
        rating,
        comment: message,
      })
      if (error) throw error
      onSubmitted()
    } catch (error) {
      setErrorMessage(error.message || '投稿に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="review-form" onSubmit={handleSubmit}>
      <div className="review-field-label">評価 *</div>
      <div className="rating-input" role="group" aria-label="評価">
        {[1, 2, 3, 4, 5].map(value => (
          <button
            key={value}
            type="button"
            className={value <= rating ? 'selected' : ''}
            aria-label={`${value}つ星`}
            aria-pressed={rating === value}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>

      <label htmlFor={`review-comment-${roomId}`}>コメント *</label>
      <textarea
        id={`review-comment-${roomId}`}
        value={comment}
        onChange={event => setComment(event.target.value)}
        maxLength={500}
        rows={4}
        required
        placeholder="この教室での充電についての感想や情報"
      />
      <small>{comment.length} / 500文字</small>
      <p className="review-note">レビューは公開されます。個人情報は書き込まないでください。</p>

      {errorMessage && <p className="review-error" role="alert">{errorMessage}</p>}
      <button
        className="save-button"
        type="submit"
        disabled={saving || rating === 0 || !comment.trim()}
      >
        {saving ? '投稿中...' : '投稿する'}
      </button>
    </form>
  )
}

function ReviewList({ roomId }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    async function loadReviews() {
      setLoading(true)
      setErrorMessage('')
      try {
        const { data, error } = await supabase
          .from('room_reviews')
          .select('id, rating, comment, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (active) setReviews(data ?? [])
      } catch (error) {
        if (active) setErrorMessage(error.message || '読み込みに失敗しました。')
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
        {average === null
          ? 'まだレビューはありません。'
          : `★ ${average.toFixed(1)} / 5（${reviews.length}件）`}
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

export default function RoomReviews({ roomId, roomName, mode, onBack, onSubmitted }) {
  return (
    <section className="room-reviews">
      <button className="review-back" type="button" onClick={onBack}>
        ← 建物に戻る
      </button>
      <h3>{roomName}のレビュー</h3>
      {mode === 'write' ? (
        <ReviewForm roomId={roomId} onSubmitted={onSubmitted} />
      ) : (
        <ReviewList roomId={roomId} />
      )}
    </section>
  )
}
