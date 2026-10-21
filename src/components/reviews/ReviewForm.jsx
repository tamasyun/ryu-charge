import { useState } from 'react'
import { createReview } from '../../services/reviews'

export default function ReviewForm({ roomId, canPost, onSubmitted }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canPost) {
      setErrorMessage('レビューの投稿には大学メールでのログインが必要です。')
      return
    }
    const message = comment.trim()
    if (saving || rating < 1 || rating > 5 || !message || message.length > 500) return

    setSaving(true)
    setErrorMessage('')
    try {
      await createReview({ roomId, rating, comment: message })
      onSubmitted()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '投稿に失敗しました。')
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
          >★</button>
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
        disabled={saving || !canPost || rating === 0 || !comment.trim()}
      >
        {saving ? '投稿中...' : '投稿する'}
      </button>
    </form>
  )
}

