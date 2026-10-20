import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { supabase } from './lib/supabase'
import { isUniversityEmail } from './lib/universityEmail'
import { getBuildingMarkerIcon } from './config/buildingMarkers'
import RoomReviews from './components/RoomReviews'
import LoginDialog from './components/LoginDialog'

function MapUpdater({ selectedBuilding }) {
  const map = useMap()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      map.invalidateSize()
      if (selectedBuilding) {
        map.panTo(
          [selectedBuilding.latitude, selectedBuilding.longitude],
          { animate: false }
        )
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [map, selectedBuilding])

  return null
}

// Preserve the destination through Supabase's full-page email redirect.
function readRedirectIntent() {
  const params = new URLSearchParams(window.location.search)
  const type = params.get('rc_intent')
  const buildingId = params.get('rc_building')
  const roomId = params.get('rc_room')
  if (!buildingId) return null
  if (type === 'add') return { type, buildingId }
  if (type === 'review' && roomId) return { type, buildingId, roomId }
  return null
}

function clearRedirectIntent() {
  const url = new URL(window.location.href)
  url.searchParams.delete('rc_intent')
  url.searchParams.delete('rc_building')
  url.searchParams.delete('rc_room')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

function App() {
  const [buildings, setBuildings] = useState([])
  const [selectedBuildingId, setSelectedBuildingId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('outlet')
  const [detailView, setDetailView] = useState('details')
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [loginIntent, setLoginIntent] = useState(null)
  const [redirectIntent, setRedirectIntent] = useState(readRedirectIntent)

  const canPost = authReady && isUniversityEmail(user?.email)
  const selectedBuilding =
    buildings.find(building => building.id === selectedBuildingId) ?? null
  const selectedRoom =
    selectedBuilding?.rooms.find(room => room.id === selectedRoomId) ?? null

  function openLogin(intent = null) {
    setLoginIntent(intent)
    setIsLoginOpen(true)
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
      if (event === 'SIGNED_IN') setIsLoginOpen(false)
      if (event === 'SIGNED_OUT') setIsFormOpen(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    setErrorMessage('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setIsLoginOpen(false)
      setLoginIntent(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'ログアウトに失敗しました。')
    } finally {
      setSigningOut(false)
    }
  }

  async function loadBuildings() {
    const { data, error } = await supabase
      .from('buildings')
      .select(`
        id, name, latitude, longitude,
        rooms (
          id, name, floor, location_detail,
          outlets (id, location_detail, ac_ports)
        )
      `)
      .order('id')
    if (error) throw error

    setBuildings((data ?? []).map(building => ({
      ...building,
      rooms: [...building.rooms].sort((a, b) =>
        (a.floor ?? 0) - (b.floor ?? 0) ||
        a.name.localeCompare(b.name, 'ja')
      ),
    })))
  }

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const { data, error } = await supabase
          .from('buildings')
          .select(`
            id, name, latitude, longitude,
            rooms (
              id, name, floor, location_detail,
              outlets (id, location_detail, ac_ports)
            )
          `)
          .order('id')
        if (error) throw error
        if (active) setBuildings(data ?? [])
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : '建物を取得できませんでした。')
      }
    }
    initialize()
    return () => { active = false }
  }, [])

  // Following a Magic Link may open the app in a new tab; the destination is
  // encoded in the redirect URL, rather than sessionStorage.
  useEffect(() => {
    const intent = redirectIntent ?? loginIntent
    if (!canPost || !intent || buildings.length === 0) return

    // Restore selection after the auth callback and building fetch are both ready.
    const frame = requestAnimationFrame(() => {
      const building = buildings.find(b => b.id === intent.buildingId)
      if (building) {
        setSelectedBuildingId(building.id)
        setFormMode(building.rooms.length ? 'outlet' : 'room')
        setErrorMessage('')
        if (intent.type === 'review' && building.rooms.some(r => r.id === intent.roomId)) {
          setSelectedRoomId(intent.roomId)
          setDetailView('write')
          setIsFormOpen(false)
        } else if (intent.type === 'add') {
          setSelectedRoomId(null)
          setDetailView('details')
          setIsFormOpen(true)
        }
      }

      if (redirectIntent) clearRedirectIntent()
      setRedirectIntent(null)
      setLoginIntent(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [canPost, buildings, redirectIntent, loginIntent])

  function selectBuilding(building) {
    setSelectedBuildingId(building.id)
    setDetailView('details')
    setSelectedRoomId(null)
    setFormMode(building.rooms.length ? 'outlet' : 'room')
    setIsFormOpen(false)
    setErrorMessage('')
  }

  async function handleAdd(event) {
    event.preventDefault()
    if (!selectedBuilding || saving) return
    if (!canPost) {
      setIsFormOpen(false)
      openLogin({ type: 'add', buildingId: selectedBuilding.id })
      return
    }

    const form = new FormData(event.currentTarget)
    const text = name => String(form.get(name) ?? '').trim()
    let table
    let record

    if (formMode === 'room') {
      const floorText = text('floor')
      const floor = floorText === '' ? null : Number(floorText)
      if (!text('name') ||
          text('name').length > 80 ||
          text('location_detail').length > 300 ||
          (floor !== null &&
            (!Number.isInteger(floor) || floor < -10 || floor > 40))) {
        setErrorMessage('教室の入力内容を確認してください。')
        return
      }
      table = 'rooms'
      record = {
        id: `room-${crypto.randomUUID()}`,
        building_id: selectedBuilding.id,
        name: text('name'),
        floor,
        location_detail: text('location_detail'),
      }
    } else {
      const roomId = text('room_id')
      const portsText = text('ac_ports')
      const ports = portsText === '' ? null : Number(portsText)
      if (!selectedBuilding.rooms.some(r => r.id === roomId) ||
          !text('location_detail') ||
          text('location_detail').length > 300 ||
          (ports !== null &&
            (!Number.isInteger(ports) || ports < 0 || ports > 50))) {
        setErrorMessage('コンセントの入力内容を確認してください。')
        return
      }
      table = 'outlets'
      record = {
        id: `outlet-${crypto.randomUUID()}`,
        room_id: roomId,
        location_detail: text('location_detail'),
        ac_ports: ports,
      }
    }

    setSaving(true)
    setErrorMessage('')
    try {
      const { error } = await supabase.from(table).insert(record)
      if (error) throw error
      await loadBuildings()
      setIsFormOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '追加できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>琉CHARGE</h1>
        <div className="auth-header">
          {!authReady ? (
            <span className="auth-status">確認中...</span>
          ) : user ? (
            <>
              <span className="auth-email" title={user.email}>{user.email}</span>
              {!canPost && <span className="auth-restricted">大学メール以外は投稿不可</span>}
              <button type="button" className="auth-button" disabled={signingOut} onClick={handleSignOut}>
                {signingOut ? '処理中...' : 'ログアウト'}
              </button>
            </>
          ) : (
            <button type="button" className="auth-button" onClick={() => openLogin()}>
              ログイン
            </button>
          )}
        </div>
      </header>

      {isLoginOpen && !user && (
        <LoginDialog
          onClose={() => setIsLoginOpen(false)}
          redirectIntent={loginIntent ?? redirectIntent}
        />
      )}

      {errorMessage && <p role="alert" className="app-error">{errorMessage}</p>}

      <main className={`map-layout ${selectedBuilding ? 'with-details' : ''}`}>
        <section className="map-area" aria-label="キャンパスの地図">
          <MapContainer
            center={[26.2508, 127.7662]}
            zoom={17}
            minZoom={15}
            maxZoom={18}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            <MapUpdater selectedBuilding={selectedBuilding} />
            {buildings.map(building => (
              <Marker
                key={building.id}
                position={[building.latitude, building.longitude]}
                icon={getBuildingMarkerIcon(building)}
                eventHandlers={{ click: () => selectBuilding(building) }}
              >
                <Popup>
                  <strong>{building.name}</strong>
                  <div>
                    コンセント設備：合計 {
                      building.rooms.reduce((total, room) => total + room.outlets.length, 0)
                    } 件
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>

        {selectedBuilding && (
          <aside className="detail-panel">
            <div className="detail-header">
              <div>
                <h2>{selectedBuilding.name}</h2>
                <p>{selectedBuilding.rooms.length}教室</p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="詳細を閉じる"
                onClick={() => {
                  setSelectedBuildingId(null)
                  setIsFormOpen(false)
                  setDetailView('details')
                  setSelectedRoomId(null)
                }}
              >×</button>
            </div>

            <div className="detail-content">
              {detailView !== 'details' && selectedRoom ? (
                <RoomReviews
                  key={selectedRoom.id}
                  roomId={selectedRoom.id}
                  roomName={selectedRoom.name}
                  mode={detailView}
                  canPost={canPost}
                  onLogin={() => {
                    if (user && !canPost) {
                      setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
                    } else {
                      openLogin({ type: 'review', buildingId: selectedBuilding.id, roomId: selectedRoom.id })
                    }
                  }}
                  onBack={() => {
                    setDetailView('details')
                    setSelectedRoomId(null)
                  }}
                  onSubmitted={() => setDetailView('reviews')}
                />
              ) : isFormOpen && canPost ? (
                <form className="add-form" onSubmit={handleAdd}>
                  <h3>データを追加</h3>
                  <label htmlFor="form-mode">追加するもの</label>
                  <select id="form-mode" value={formMode} onChange={e => setFormMode(e.target.value)}>
                    <option value="room">教室</option>
                    <option value="outlet" disabled={!selectedBuilding.rooms.length}>コンセント</option>
                  </select>

                  {formMode === 'room' ? (
                    <>
                      <label htmlFor="room-name">教室名 *</label>
                      <input
                        id="room-name" name="name" required maxLength="80"
                        placeholder="例：A102教室"
                      />
                      <label htmlFor="room-floor">階数</label>
                      <input
                        id="room-floor" name="floor" type="number"
                        min="-10" max="40" step="1" placeholder="例：1"
                      />
                      <label htmlFor="room-location">場所の説明</label>
                      <textarea id="room-location" name="location_detail" maxLength="300" rows="3" />
                    </>
                  ) : (
                    <>
                      <label htmlFor="outlet-room">教室 *</label>
                      <select id="outlet-room" name="room_id" required>
                        {selectedBuilding.rooms.map(room => (
                          <option key={room.id} value={room.id}>{room.name}</option>
                        ))}
                      </select>
                      <label htmlFor="outlet-location">コンセントの位置 *</label>
                      <textarea
                        id="outlet-location" name="location_detail" required
                        maxLength="300" rows="3" placeholder="例：窓際の机の下"
                      />
                      <label htmlFor="outlet-ports">AC差込口数</label>
                      <input
                        id="outlet-ports" name="ac_ports" type="number"
                        min="0" max="50" step="1" placeholder="例：2"
                      />
                    </>
                  )}
                  <p className="form-note">* 必須項目。登録した情報は他の利用者にも公開されます。</p>
                  <button type="submit" className="save-button" disabled={saving}>
                    {saving ? '保存中...' : '追加する'}
                  </button>
                </form>
              ) : (
                <>
                  {selectedBuilding.rooms.length === 0 && <p>教室はまだ登録されていません。</p>}
                  {selectedBuilding.rooms.map(room => (
                    <section key={room.id} className="room-detail">
                      <div className="room-heading">
                        <h3>
                          {room.name}
                          {room.floor != null ? `（${room.floor}階）` : ''}
                        </h3>
                        <button
                          type="button"
                          className="write-review-button"
                          disabled={!authReady}
                          onClick={() => {
                            setSelectedRoomId(room.id)
                            setIsFormOpen(false)
                            setDetailView('write')
                            if (!canPost && !user) {
                              openLogin({ type: 'review', buildingId: selectedBuilding.id, roomId: room.id })
                            }
                          }}
                        >レビューを投稿</button>
                      </div>
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
                      <button
                        type="button"
                        className="review-list-link"
                        onClick={() => {
                          setSelectedRoomId(room.id)
                          setIsFormOpen(false)
                          setDetailView('reviews')
                        }}
                      >
                        <span>この部屋のレビューを見る</span>
                        <span aria-hidden="true">→</span>
                      </button>
                    </section>
                  ))}
                </>
              )}
            </div>

            {detailView === 'details' && (
              <div className="detail-footer">
                <button
                  type="button"
                  className="add-button"
                  disabled={!authReady}
                  onClick={() => {
                    setErrorMessage('')
                    if (!canPost) {
                      if (user) {
                        setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
                      } else {
                        setIsFormOpen(false)
                        openLogin({ type: 'add', buildingId: selectedBuilding.id })
                      }
                      return
                    }
                    setIsFormOpen(open => !open)
                  }}
                >
                  {!authReady
                    ? '確認中...'
                    : !canPost
                      ? 'ログインして追加'
                      : isFormOpen
                        ? 'キャンセル'
                        : '＋ 追加'}
                </button>
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  )
}

export default App
