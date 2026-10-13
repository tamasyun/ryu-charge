
import { useEffect, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import spotsData from './data/spots.json'
function App() {
  const [selectedBuilding, setSelectedBuilding] = useState(null)

  return (
    <div className="app">
      <header className="app-header">
        <h1>琉CHARGE</h1>
      </header>

      <main className={`map-layout ${selectedBuilding ? 'with-details' : ''}`}>
        <section className="map-area" aria-label="キャンパスの地図">
          <MapContainer
            center={[26.2508, 127.7662]}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />

            <MapUpdater selectedBuilding={selectedBuilding} />

            {spotsData.buildings.map((building) => (
              <Marker
                key={building.id}
                position={[building.latitude, building.longitude]}
                eventHandlers={{
                  click: () => setSelectedBuilding(building),
                }}
              />
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
                onClick={() => setSelectedBuilding(null)}
                aria-label="詳細を閉じる"
              >
                ×
              </button>
            </div>

            {selectedBuilding.rooms.map((room) => (
              <section key={room.id} className="room-detail">
                <h3>{room.name}（{room.floor}階）</h3>
                <p>{room.location_detail}</p>

                <ul>
                  {room.outlets.map((outlet) => (
                    <li key={outlet.id}>
                      <strong>{outlet.location_detail}</strong>
                      <span>
                        {outlet.ac_ports === null
                          ? 'AC口数未確認'
                          : `AC ${outlet.ac_ports}口`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </aside>
        )}
      </main>
    </div>
  )
}


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

export default App