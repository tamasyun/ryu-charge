
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { supabase } from './lib/supabase'
import { getBuildingMarkerIcon } from './config/buildingMarkers'
import RoomReviews from './components/RoomReviews'

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

function App() {
  const [buildings, setBuildings] = useState([])
  const [selectedBuildingId, setSelectedBuildingId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('outlet')
  const [detailView, setDetailView] = useState('details')
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const selectedBuilding =
    buildings.find(b => b.id === selectedBuildingId) ?? null
  const selectedRoom =
    selectedBuilding?.rooms.find(room => room.id === selectedRoomId) ?? null

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
      )
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
        if (active) setErrorMessage(error.message)
      }
    }

    initialize()
    return () => { active = false }
  }, [])

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
      setErrorMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>琉CHARGE</h1>
      </header>

      {errorMessage && (
        <p role="alert" className="app-error">{errorMessage}</p>
      )}

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
                eventHandlers={{
                  click: () => selectBuilding(building),
                }}
              >
                <Popup>
                  <strong>{building.name}</strong>
                  <div>
                    コンセント設備：合計 {
                      building.rooms.reduce(
                        (total, room) => total + room.outlets.length,
                        0
                      )
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
              >
                ×
              </button>
            </div>

            <div className="detail-content">
              {detailView !== 'details' && selectedRoom ? (
                <RoomReviews
                  key={selectedRoom.id}
                  roomId={selectedRoom.id}
                  roomName={selectedRoom.name}
                  mode={detailView}
                  onBack={() => {
                    setDetailView('details')
                    setSelectedRoomId(null)
                  }}
                  onSubmitted={() => setDetailView('reviews')}
                />
              ) : isFormOpen ? (
                <form className="add-form" onSubmit={handleAdd}>
                  <h3>データを追加</h3>

                  <label htmlFor="form-mode">追加するもの</label>
                  <select
                    id="form-mode"
                    value={formMode}
                    onChange={e => setFormMode(e.target.value)}
                  >
                    <option value="room">教室</option>
                    <option
                      value="outlet"
                      disabled={!selectedBuilding.rooms.length}
                    >
                      コンセント
                    </option>
                  </select>

                  {formMode === 'room' ? (
                    <>
                      <label htmlFor="room-name">教室名 *</label>
                      <input
                        id="room-name"
                        name="name"
                        required
                        maxLength="80"
                        placeholder="例：A102教室"
                      />

                      <label htmlFor="room-floor">階数</label>
                      <input
                        id="room-floor"
                        name="floor"
                        type="number"
                        min="-10"
                        max="40"
                        step="1"
                        placeholder="例：1"
                      />

                      <label htmlFor="room-location">場所の説明</label>
                      <textarea
                        id="room-location"
                        name="location_detail"
                        maxLength="300"
                        rows="3"
                      />
                    </>
                  ) : (
                    <>
                      <label htmlFor="outlet-room">教室 *</label>
                      <select id="outlet-room" name="room_id" required>
                        {selectedBuilding.rooms.map(room => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>

                      <label htmlFor="outlet-location">
                        コンセントの位置 *
                      </label>
                      <textarea
                        id="outlet-location"
                        name="location_detail"
                        required
                        maxLength="300"
                        rows="3"
                        placeholder="例：窓際の机の下"
                      />

                      <label htmlFor="outlet-ports">
                        AC差込口数
                      </label>
                      <input
                        id="outlet-ports"
                        name="ac_ports"
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder="例：2"
                      />
                    </>
                  )}

                  <p className="form-note">
                    * 必須項目。登録した情報は他の利用者にも公開されます。
                  </p>

                  <button
                    type="submit"
                    className="save-button"
                    disabled={saving}
                  >
                    {saving ? '保存中...' : '追加する'}
                  </button>
                </form>
              ) : (
                <>
                  {selectedBuilding.rooms.length === 0 && (
                    <p>教室はまだ登録されていません。</p>
                  )}

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
                          onClick={() => {
                            setSelectedRoomId(room.id)
                            setIsFormOpen(false)
                            setDetailView('write')
                          }}
                        >
                          レビューを投稿
                        </button>
                      </div>
                      <p>{room.location_detail}</p>

                      {room.outlets.length === 0 ? (
                        <p>コンセントは未登録です。</p>
                      ) : (
                        <ul>
                          {room.outlets.map(outlet => (
                            <li key={outlet.id}>
                              <strong>{outlet.location_detail}</strong>
                              <span>
                                {outlet.ac_ports == null
                                  ? 'AC口数未確認'
                                  : `AC ${outlet.ac_ports}口`}
                              </span>
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
                  onClick={() => {
                    setIsFormOpen(!isFormOpen)
                    setErrorMessage('')
                  }}
                >
                  {isFormOpen ? 'キャンセル' : '＋ 追加'}
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
