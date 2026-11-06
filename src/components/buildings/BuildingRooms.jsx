import { IMAGE_ACCEPT } from '../../utils/imageProcessor.js'
import { authorLabel } from '../../utils/nickname'

function reviewOverviewLabel(overview, buildingId, roomId) {
  if (overview.buildingId !== buildingId || overview.status === 'loading') {
    return '概要を読み込み中...'
  }
  if (overview.status === 'error') return '概要を取得できませんでした'
  const summary = overview.byRoom[roomId]
  if (!summary) return 'まだレビューはありません'
  return `★ ${(summary.ratingTotal / summary.count).toFixed(1)} ／ 5 ・ ${summary.count}件`
}

export default function BuildingRooms({
  building,
  reviewOverview,
  roomPhotos = {},
  canPost,
  uploadingRoomId,
  photoProgress,
  onAddPhotos,
  onShowReviews,
}) {
  return (
    <>
      {building.rooms.length === 0 && <p>教室はまだ登録されていません。</p>}
      {building.rooms.map(room => {
        const photos = roomPhotos[room.id] ?? []
        const isUploading = uploadingRoomId === room.id

        return (
          <section key={room.id} className="room-detail">
            <h3>
              {room.name}
              {room.floor != null ? `（${room.floor}階）` : ''}
              <span className="contributor-name">追加：{authorLabel(room.author_nickname)}</span>
            </h3>
            <p>{room.location_detail}</p>

            <div className="room-photo-section">
              {canPost && (
                <label className={`room-photo-add ${isUploading ? 'is-uploading' : ''}`}>
                  {isUploading ? '写真を処理中...' : '＋ 写真を追加'}
                  <input
                    type="file"
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

              {canPost && <small>1回5枚まで。写真は自動で変換・圧縮します（変換後1枚5MBまで）。</small>}
              {isUploading && photoProgress && (
                <p role="status">
                  {photoProgress.phase === 'processing' ? '写真を変換中' : photoProgress.phase === 'saving' ? '写真を保存中' : 'アップロード中'}
                  ... {photoProgress.current} / {photoProgress.total}枚
                </p>
              )}
              {photos.length > 0 && (
                <div className="room-photo-list">
                  {photos.map(photo => (
                    <a
                      className="room-photo-item"
                      href={photo.image_url}
                      target="_blank"
                      rel="noreferrer"
                      key={photo.id}
                      aria-label={`${room.name}の写真を拡大表示`}
                    >
                      <img
                        className="room-photo"
                        src={photo.image_url}
                        alt={`${room.name}のコンセント・教室の写真`}
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
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
        )
      })}
    </>
  )
}
