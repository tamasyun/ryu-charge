import { useState, useRef } from 'react'
import { createReview, uploadReviewImage } from '../../services/reviews'

export default function ReviewForm({ roomId, canPost, onSubmitted }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef(null)

  function handleImageChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('画像サイズは5MB以下にしてください。')
      return
    }

    setErrorMessage('')
    setImageFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handleRemoveImage() {
    setImageFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canPost) {
      setErrorMessage('レビューの投稿には大学メールでのログインが必要です。')
      return
    }

    // 星評価（1〜5）のみを必須とし、コメントは任意（500文字以内）
    const message = comment.trim()
    if (saving || rating < 1 || rating > 5 || message.length > 500) return

    setSaving(true)
    setErrorMessage('')
    try {
      let imageUrl = null
      if (imageFile) {
        imageUrl = await uploadReviewImage(imageFile)
      }

      // コメントが空なら空文字またはnullを送信
      await createReview({
        roomId,
        rating,
        comment: message || null,
        imageUrl,
      })
      onSubmitted()
    } catch (error) {
      console.error('投稿エラー:', error)
      const msg = error?.message || (error instanceof Error ? error.message : '投稿に失敗しました。')
      setErrorMessage(msg)
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

      {/* コメントを（任意）に変更 */}
      <label htmlFor={`review-comment-${roomId}`}>コメント（任意）</label>
      <textarea
        id={`review-comment-${roomId}`}
        value={comment}
        onChange={event => setComment(event.target.value)}
        maxLength={500}
        rows={4}
        placeholder="この教室での充電についての感想や情報（省略可）"
      />
      <small>{comment.length} / 500文字</small>

      {/* 写真選択 */}
      <label htmlFor={`review-photo-${roomId}`}>写真（任意）</label>
      <input
        id={`review-photo-${roomId}`}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
      />
      {previewUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
          <img
            src={previewUrl}
            alt="プレビュー"
            style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            style={{ background: 'transparent', border: 0, color: 'var(--text)', fontSize: '12px', cursor: 'pointer', padding: 0 }}
          >
            写真を削除
          </button>
        </div>
      )}

      <p className="review-note">レビューは公開されます。個人情報は書き込まないでください。</p>
      {errorMessage && <p className="review-error" role="alert">{errorMessage}</p>}
      
      {/* disabled の判定から !comment.trim() を削除（星を選べば投稿可能） */}
      <button
        className="save-button"
        type="submit"
        disabled={saving || !canPost || rating === 0}
      >
        {saving ? '投稿中...' : '投稿する'}
      </button>
    </form>
  )
}