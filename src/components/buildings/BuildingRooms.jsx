function reviewOverviewLabel(overview, buildingId, roomId) {
  if (overview.buildingId !== buildingId || overview.status === 'loading') {
    return '概要を読み込み中...'
  }
  if (overview.status === 'error') return '概要を取得できませんでした'
  const summary = overview.byRoom[roomId]
  if (!summary) return 'まだレビューはありません'
  return `★ ${(summary.ratingTotal / summary.count).toFixed(1)} ／ 5 ・ ${summary.count}件`
}

export default function BuildingRooms({ building, reviewOverview, onShowReviews }) {
  return (
    <>
      {building.rooms.length === 0 && <p>教室はまだ登録されていません。</p>}
      {building.rooms.map(room => (
        <section key={room.id} className="room-detail">
          <h3>
            {room.name}
            {room.floor != null ? `（${room.floor}階）` : ''}
          </h3>
          <p>{room.location_detail}</p>

          {room.outlets.length === 0 ? (
            <p>コンセントは未登録です。</p>
          ) : (
            <ul>
              {room.outlets.map(outlet => (
                <li key={outlet.id}>
                  <strong>{outlet.location_detail}</strong>
                  <span>{outlet.ac_ports == null ? 'AC口数未確認' : `AC ${outlet.ac_ports}口`}</span>
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
      ))}
    </>
  )
}
