import { useEffect, useState } from 'react'
import { WEEKDAYS } from '../../utils/roomAccess.js'
import { authorLabel } from '../../utils/nickname'
import PostActionsMenu from '../PostActionsMenu'
import './RoomAccess.css'

function scheduleLabel(post) {
  const days = WEEKDAYS.filter((_, index) => post.weekdays.includes(index + 1))
  const everyDay = days.length === WEEKDAYS.length
  const start = post.starts_at.slice(0, 5)
  const end = post.ends_at.slice(0, 5)
  const hours = start === '00:00' && end === '24:00' ? '終日' : `${start}〜${end}`
  return `${everyDay ? '毎日' : days.join('・') + '曜日'} ${hours}`
}

export default function RoomAccessList({ roomId, userId, loadRoomAccess, revision, saving, onEdit, onDelete }) {
  const [result, setResult] = useState(null)
  const current = result?.revision === revision && result?.userId === userId ? result : null
  useEffect(() => {
    let active = true
    loadRoomAccess(roomId).then(data => {
      if (active) setResult({ ...data, revision, userId })
    }).catch(() => {
      if (active) setResult({ failed: true, revision, userId })
    })
    return () => { active = false }
  }, [loadRoomAccess, roomId, revision, userId])

  return (
    <section className="room-access-section" aria-label="教室の情報">
      <h4>教室の情報</h4>
      {!current ? <p role="status">利用条件を読み込み中…</p>
        : current.failed ? <p className="review-error" role="alert">利用条件を取得できませんでした。</p>
        : !current.posts.length ? <p>利用条件は未登録です。</p>
        : current.posts.map(post => (
          <article className="room-access-post" key={post.id}>
            <div>
              <strong>{scheduleLabel(post)}</strong>
              <p>{post.academic_unit_ids.map(id => current.names.get(id) ?? '所属不明').join('、')}</p>
              <span className="contributor-name">追加：{authorLabel(post.author_nickname)}</span>
            </div>
            {userId && post.user_id === userId && (
              <PostActionsMenu
                label={`教室の情報（${scheduleLabel(post)}）`}
                disabled={saving}
                onEdit={() => onEdit(post)}
                onDelete={() => onDelete(post.id)}
              />
            )}
          </article>
        ))}
    </section>
  )
}
