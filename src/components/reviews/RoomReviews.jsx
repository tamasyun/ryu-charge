import { useEffect, useState } from 'react'
import ReviewList from './ReviewList'
import './RoomReviews.css'
import { checkUserHasReviewed } from '../../services/reviews'

export default function RoomReviews({
  roomId,
  canPost,
  authReady,
  isLoggedIn,
  onWrite,
  onEdit,
  onLogin,
  onDeleted,
  reviewVersion,
}) {
  const [hasReviewed, setHasReviewed] = useState(false)

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

  return (
    <section className="room-reviews">
      <div className="review-list-heading">
        <h4>レビュー</h4>
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
      <ReviewList
        roomId={roomId}
        reviewVersion={reviewVersion}
        onEdit={canPost ? onEdit : undefined}
        onDeleted={() => {
          setHasReviewed(false)
          onDeleted()
        }}
      />
    </section>
  )
}
