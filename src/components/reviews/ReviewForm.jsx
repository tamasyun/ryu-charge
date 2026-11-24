import { useState, useRef, useEffect } from 'react'
import { createReview, updateReview } from '../../services/reviews'
import { IMAGE_ACCEPT, processImage } from '../../utils/imageProcessor.js'
import { demoAccount } from '../../demo/account.js'

export default function ReviewForm({ roomId, roomName, review, canPost, onCancel, onSubmitted }) {
  const isEditing = Boolean(review)
  const [rating, setRating] = useState(review?.rating ?? 0)
  const [comment, setComment] = useState(review?.comment ?? '')
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [imageError, setImageError] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef(null)
  const titleRef = useRef(null)

  const selectionVersion = useRef(0)
  const savingRef = useRef(false)
  const processingRef = useRef(false)

  useEffect(() => () => { selectionVersion.current += 1 }, [])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => { titleRef.current?.focus() }, [])

  async function handleImageChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || savingRef.current) return
    const version = ++selectionVersion.current
    setImageFile(null)
    setPreviewUrl(null)
    setErrorMessage('')
    setImageError(false)
    setProcessing(true)
    processingRef.current = true
    try {
      const converted = await processImage(file)
      if (version !== selectionVersion.current) return
      setImageFile(converted)
      setPreviewUrl(URL.createObjectURL(converted))
    } catch (error) {
      if (version === selectionVersion.current) {
        setImageError(true)
        setErrorMessage(error.message)
      }
    } finally {
      if (version === selectionVersion.current) {
        setProcessing(false)
        processingRef.current = false
      }
    }
  }

  function handleRemoveImage() {
    if (savingRef.current) return
    selectionVersion.current += 1
    processingRef.current = false
    setProcessing(false)
    setImageError(false)
    setImageFile(null)
    setPreviewUrl(null)
    setErrorMessage('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canPost) {
      setErrorMessage('レビューの保存には大学メールでのログインが必要です。')
      return
    }

    // 星評価（1〜5）のみを必須とし、コメントは任意（500文字以内）
    const message = comment.trim()
    if (savingRef.current || processingRef.current || imageError || rating < 1 || rating > 5 || message.length > 500) return

    savingRef.current = true
    setSaving(true)
    setErrorMessage('')
    try {
      const fields = { rating, comment: message || null }
      if (isEditing) {
        await updateReview(review.id, fields)
      } else {
        await createReview({ roomId, ...fields, imageFile })
      }
      onSubmitted()
    } catch (error) {
      setErrorMessage(error?.message || 'レビューを保存できませんでした。')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <form className="review-form" onSubmit={handleSubmit}>
      {onCancel && (
        <button type="button" className="review-back" onClick={onCancel} disabled={saving}>
          ← 教室に戻る
        </button>
      )}
      <h3 ref={titleRef} tabIndex={-1}>
        {roomName && `${roomName}の`}レビューを{isEditing ? '編集' : '投稿'}
      </h3>
      <div className="review-field-label">評価 *</div>
      <div className="rating-input" role="group" aria-label="評価">
        {[1, 2, 3, 4, 5].map(value => (
          <button
            key={value}
            type="button"
            className={value <= rating ? 'selected' : ''}
            aria-label={`${value}つ星`}
            aria-pressed={rating === value}
            disabled={saving}
            onClick={() => setRating(value)}
          >★</button>
        ))}
      </div>

      <label htmlFor={`review-comment-${roomId}`}>コメント（任意）</label>
      <textarea
        id={`review-comment-${roomId}`}
        value={comment}
        onChange={event => setComment(event.target.value)}
        disabled={saving}
        maxLength={500}
        rows={4}
        placeholder="この教室での充電についての感想や情報（省略可）"
      />
      <small>{comment.length} / 500文字</small>

      {isEditing && review.image_url && (
        <img src={review.image_url} alt="投稿済みのレビュー写真" className="review-photo-thumbnail" />
      )}
      {!isEditing && (
        <>
          <label htmlFor={`review-photo-${roomId}`}>写真（任意）</label>
          <input
            id={`review-photo-${roomId}`}
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            disabled={saving}
            onChange={handleImageChange}
          />
          {processing && <p role="status">写真を変換中...</p>}
          {(previewUrl || processing || imageError) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
              {previewUrl && <img
                src={previewUrl}
                alt="プレビュー"
                style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }}
              />}
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={saving}
                style={{ background: 'transparent', border: 0, color: 'var(--text)', fontSize: '12px', cursor: 'pointer', padding: 0 }}
              >
                写真を削除
              </button>
            </div>
          )}
        </>
      )}

      {!demoAccount.isActive() && <p className="review-note">レビューは公開されます。個人情報は書き込まないでください。</p>}
      {errorMessage && <p className="review-error" role="alert">{errorMessage}</p>}

      <button
        className="save-button"
        type="submit"
        disabled={saving || processing || imageError || !canPost || rating === 0 || comment.trim().length > 500}
      >
        {processing ? '写真を変換中...' : saving ? '保存中...' : isEditing ? '保存する' : '投稿する'}
      </button>
    </form>
  )
}
