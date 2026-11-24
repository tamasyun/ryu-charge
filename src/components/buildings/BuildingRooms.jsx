import { useEffect, useRef, useState } from 'react'
import BuildingDataForm from './BuildingDataForm'
import { roomEditDeadline } from '../../utils/roomEditDeadline.js'
import PhotoViewer from '../photos/PhotoViewer'
import { IMAGE_ACCEPT } from '../../utils/imageProcessor.js'
import { authorLabel } from '../../utils/nickname'

function reviewOverviewLabel(overview, buildingId, roomId) {
  if (overview.buildingId !== buildingId || overview.status === 'loading') {
    return '概要を読み込み中...'
  }
  if (overview.status === 'error') return '概要を取得できませんでした'
  const summary = overview.byRoom[roomId]
  if (!summary) return 'まだレビューはありません'
  return `★ ${(summary.ratingTotal / summary.count).toFixed(1)} ・ レビュー${summary.count}件`
}

function RecordActions({ label, disabled, onEdit, onDelete }) {
  return (
    <div className="record-actions">
      <button type="button" aria-label={`${label}を編集`} disabled={disabled} onClick={onEdit}>編集</button>
      <button type="button" aria-label={`${label}を削除`} disabled={disabled} onClick={onDelete}>削除</button>
    </div>
  )
}

function RoomDetails({
  building, room, reviewOverview, roomPhotos = {}, canPost, userId, uploadingRoomId,
  photoProgress, onAddPhotos, onShowReviews, onBack, onChangeRecord, onStartEdit,
}) {
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now)
  const changeLock = useRef(false)
  const isRoomOwner = Boolean(userId && room.user_id === userId)
  const deadline = roomEditDeadline(room.created_at)
  const canManageRoom = isRoomOwner && deadline > currentTime

  useEffect(() => {
    if (!canManageRoom) return
    const timer = window.setTimeout(() => setCurrentTime(deadline), deadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [canManageRoom, deadline])

  function startEdit(table, id) {
    setErrorMessage('')
    setEditing({ table, id })
    onStartEdit?.()
  }

  async function changeRecord(table, id, changes = null) {
    if (changeLock.current) return
    const label = table === 'rooms' ? '教室' : 'コンセント'
    if (!changes && !window.confirm(`この${label}を削除しますか？`)) return

    changeLock.current = true
    setSaving(true)
    setErrorMessage('')
    try {
      await onChangeRecord(table, id, changes)
      setEditing(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${label}を${changes ? '保存' : '削除'}できませんでした。`)
    } finally {
      changeLock.current = false
      setSaving(false)
    }
  }

  const photos = roomPhotos[room.id] ?? []
  const isUploading = uploadingRoomId === room.id
  const editRecord = editing?.table === 'rooms'
    ? (canManageRoom ? room : null)
    : room.outlets.find(outlet => outlet.id === editing?.id && outlet.user_id === userId)
  const message = errorMessage && <p className="review-error" role="alert">{errorMessage}</p>

  if (editRecord) {
    return (
      <>
        {message}
        <BuildingDataForm
          building={building}
          formMode={editing.table === 'rooms' ? 'room' : 'outlet'}
          record={editing.table === 'rooms' ? editRecord : { ...editRecord, room_id: room.id }}
          onSubmit={fields => changeRecord(editing.table, editRecord.id, fields)}
          onCancel={() => {
            setEditing(null)
            setErrorMessage('')
          }}
          saving={saving}
        />
      </>
    )
  }

  return (
    <div className="room-detail-view">
      {/* 一覧に戻るボタン */}
      <button
        type="button"
        className="review-back"
        onClick={onBack}
        style={{ marginBottom: '12px' }}
      >
        ← 教室一覧に戻る
      </button>

      <section className="room-detail" style={{ borderTop: 'none', paddingTop: 0 }}>
        <h3>
          {room.name}
          {room.floor != null ? `（${room.floor}階）` : ''}
          <span className="contributor-name">追加：{authorLabel(room.author_nickname)}</span>
        </h3>
        <p>{room.location_detail}</p>
        {message}
        {isRoomOwner && Number.isFinite(deadline) && (
          <p>
            {canManageRoom ? (
              <>編集・削除期限 <time dateTime={new Date(deadline).toISOString()}>
                {new Date(deadline).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo' })}
              </time></>
            ) : '教室の編集・削除期限は終了しました。'}
          </p>
        )}
        {canManageRoom && (
          <RecordActions
            label="教室"
            disabled={saving}
            onEdit={() => startEdit('rooms', room.id)}
            onDelete={() => changeRecord('rooms', room.id)}
          />
        )}

        <div className="room-photo-section">
          <div className="room-photo-list" role="group" aria-label={`${room.name}の写真`} data-base-ui-swipe-ignore>
            <PhotoViewer
              photos={photos.map(photo => ({
                id: photo.id,
                src: photo.image_url,
                alt: `${room.name}のコンセント・教室の写真`,
              }))}
              className="room-photo-item"
              imageClassName="room-photo"
            />
            {canPost && (
              <label className={`room-photo-add ${uploadingRoomId != null ? 'is-disabled' : ''}`}>
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M14 5h-3l-2 3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3" />
                  <path d="M19 2v6m-3-3h6" strokeLinecap="round" />
                </svg>
                <span>{isUploading ? '追加中...' : '写真を追加'}</span>
                <input
                  type="file"
                  aria-label={`${room.name}に写真を追加`}
                  accept={IMAGE_ACCEPT}
                  multiple
                  disabled={uploadingRoomId != null}
                  onChange={event => {
                    const files = Array.from(event.target.files ?? [])
                    if (files.length > 0) onAddPhotos(room.id, files)
                    event.target.value = ''
                  }}
                />
              </label>
            )}
          </div>
          {isUploading && photoProgress && (
            <p role="status">
              {photoProgress.phase === 'processing' ? '写真を変換中' : photoProgress.phase === 'saving' ? '写真を保存中' : 'アップロード中'}
              ... {photoProgress.current} / {photoProgress.total}枚
            </p>
          )}
        </div>

        {room.outlets.length === 0 ? (
          <p>コンセントは未登録です。</p>
        ) : (
          <ul>
            {room.outlets.map(outlet => (
              <li key={outlet.id}>
                <strong>{outlet.location_detail}</strong>
                <div>
                  <span>{outlet.ac_ports == null ? 'AC口数未確認' : `AC ${outlet.ac_ports}口`}</span>
                  <span className="contributor-name">追加：{authorLabel(outlet.author_nickname)}</span>
                </div>
                {userId && outlet.user_id === userId && (
                  <RecordActions
                    label="コンセント"
                    disabled={saving}
                    onEdit={() => startEdit('outlets', outlet.id)}
                    onDelete={() => changeRecord('outlets', outlet.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="review-list-link" onClick={() => onShowReviews(room.id)}>
          <span className="review-link-content">
            <span>レビューを見る</span>
            <span className="review-link-overview">
              {reviewOverviewLabel(reviewOverview, building.id, room.id)}
            </span>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
  )
}

export default function BuildingRooms({ building, reviewOverview, onBackToBuildings, ...roomDetails }) {
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const selectedRoom = building.rooms.find(room => room.id === selectedRoomId)

  if (building.rooms.length === 0) {
    return (
      <div>
        {onBackToBuildings && (
          <button
            type="button"
            className="review-back"
            onClick={onBackToBuildings}
            style={{ marginBottom: '12px' }}
          >
            ← 建物一覧に戻る
          </button>
        )}
        <p style={{ padding: '16px 0', color: 'var(--text)' }}>教室はまだ登録されていません。</p>
      </div>
    )
  }

  if (selectedRoom) {
    return (
      <RoomDetails
        key={selectedRoom.id}
        building={building}
        room={selectedRoom}
        reviewOverview={reviewOverview}
        onBack={() => setSelectedRoomId(null)}
        {...roomDetails}
      />
    )
  }

  return (
    <div className="room-selector-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 0' }}>
      {/* ★ 建物一覧に戻るボタン */}
      {onBackToBuildings && (
        <button
          type="button"
          className="review-back"
          onClick={onBackToBuildings}
          style={{ marginBottom: '8px', alignSelf: 'flex-start' }}
        >
          ← 建物一覧に戻る
        </button>
      )}

      {building.rooms.map(room => {
        const outletCount = room.outlets.length
        return (
          <button
            key={room.id}
            type="button"
            onClick={() => setSelectedRoomId(room.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              background: 'var(--bg, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: '8px',
              textAlign: 'left',
              cursor: 'pointer',
              color: 'var(--text-h, #111)',
              font: 'inherit',
              transition: 'background 0.15s ease'
            }}
          >
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>
                {room.name}
                {room.floor != null ? `（${room.floor}階）` : ''}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text, #666)', marginTop: '4px' }}>
                🔌 コンセント {outletCount}件 ・ {reviewOverviewLabel(reviewOverview, building.id, room.id)}
              </div>
            </div>
            <span style={{ color: 'var(--text, #999)', fontSize: '18px', marginLeft: '8px' }} aria-hidden="true">
              ›
            </span>
          </button>
        )
      })}
    </div>
  )
}
