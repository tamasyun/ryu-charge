import ReviewForm from './ReviewForm'
import ReviewList from './ReviewList'
import './RoomReviews.css'

export default function RoomReviews({ roomId, roomName, mode, canPost, authReady, isLoggedIn, onWrite, onLogin, onBack, onSubmitted }) {
  return (
    <section className="room-reviews">
      <button className="review-back" type="button" onClick={onBack}>
        ← 建物に戻る
      </button>
      {mode === 'write' ? (
        <>
          <h3>{roomName}のレビューを投稿</h3>
          {canPost ? (
            <ReviewForm roomId={roomId} canPost={canPost} onSubmitted={onSubmitted} />
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
              disabled={!authReady}
              onClick={canPost ? onWrite : onLogin}
            >
              {!authReady ? '確認中...' : isLoggedIn ? 'レビューを投稿' : 'ログインして投稿'}
            </button>
          </div>
          <ReviewList roomId={roomId} />
        </>
      )}
    </section>
  )
}
