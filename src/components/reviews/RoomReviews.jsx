import { useEffect, useRef, useState } from 'react'
import ReviewForm from './ReviewForm'
import ReviewList from './ReviewList'
import './RoomReviews.css'
import { checkUserHasReviewed } from '../../services/reviews'

export default function RoomReviews({
  roomId,
  isWriting,
  canPost,
  authReady,
  isLoggedIn,
  onWrite,
  onCancel,
  onLogin,
  onSubmitted,
  onDeleted,
  reviewVersion,
}) {
  const [hasReviewed, setHasReviewed] = useState(false)
  const headingRef = useRef(null)

  // 教室やレビューが更新された時に、ログイン中のユーザーが投稿済みか確認する
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
  }, [roomId, isLoggedIn, reviewVersion])

  useEffect(() => {
    if (!isWriting) return
    const frame = requestAnimationFrame(() => {
      headingRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [isWriting])

  function handleFormSubmitted() {
    setHasReviewed(true)
    onSubmitted()
  }

  return (
    <section className="room-reviews">
      <div className="review-list-heading" ref={headingRef}>
        <h4>レビュー</h4>
        <button
          type="button"
          className="write-review-button"
          disabled={!isWriting && (!authReady || hasReviewed)}
          onClick={isWriting ? onCancel : canPost ? onWrite : onLogin}
        >
          {isWriting
            ? '投稿をキャンセル'
            : !authReady
            ? '確認中...'
            : !isLoggedIn
            ? 'ログインして投稿'
            : hasReviewed
            ? 'レビュー済み'
            : 'レビューを投稿'}
        </button>
      </div>
      {isWriting ? (
        <ReviewForm roomId={roomId} canPost={canPost} onSubmitted={handleFormSubmitted} />
      ) : (
        <ReviewList roomId={roomId} reviewVersion={reviewVersion} onDeleted={() => {
          setHasReviewed(false)
          onDeleted()
        }} />
      )}
    </section>
  )
}
