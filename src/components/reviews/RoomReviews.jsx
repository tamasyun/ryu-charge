import { useEffect, useState } from 'react'
import ReviewForm from './ReviewForm'
import ReviewList from './ReviewList'
import './RoomReviews.css'
import { checkUserHasReviewed } from '../../services/reviews'

export default function RoomReviews({ roomId, roomName, mode, canPost, authReady, isLoggedIn, onWrite, onLogin, onBack, onSubmitted }) {
  const [hasReviewed, setHasReviewed] = useState(false)

  // 部屋が変わった時やログイン状態が変わった時に、投稿済みか確認する
  useEffect(() => {
    let active = true
    async function check() {
      if (!isLoggedIn) {
        setHasReviewed(false)
        return
      }
      const reviewed = await checkUserHasReviewed(roomId)
      if (active) setHasReviewed(reviewed)
    }
    check()
    return () => { active = false }
  }, [roomId, isLoggedIn])

  function handleFormSubmitted() {
    setHasReviewed(true)
    onSubmitted?.()
  }

  return (
    <section className="room-reviews">
      <button className="review-back" type="button" onClick={onBack}>
        ← 建物に戻る
      </button>
      {mode === 'write' ? (
        <>
          <h3>{roomName}のレビューを投稿</h3>
          {canPost ? (
            <ReviewForm roomId={roomId} canPost={canPost} onSubmitted={handleFormSubmitted} />
          ) : (
            <div className="review-login-required">
              <p>レビューの投稿には琉球大学のメールアドレスでのログインが必要です。</p>
              <button type="button" className="save-button" onClick={onLogin}>
                ログインして投稿
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="review-list-heading">
            <h3>{roomName}のレビュー</h3>
            <button
              type="button"
              className="write-review-button"
              disabled={!authReady || hasReviewed}
              onClick={canPost ? onWrite : onLogin}
            >
              {!authReady
                ? '確認中...'
                : !isLoggedIn
                ? 'ログインして投稿'
                : hasReviewed
                ? 'レビュー済み'
                : 'レビューを投稿'}
            </button>
          </div>
          <ReviewList roomId={roomId} onDeleted={() => setHasReviewed(false)} />
        </>
      )}
    </section>
  )
}