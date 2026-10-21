import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMap, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getBuildingMarkerIcon } from '../../config/buildingMarkers'

function MapUpdater({ selectedBuilding, isMobile }) {
  const map = useMap()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      map.invalidateSize()
      if (selectedBuilding) {
        map.panTo(
          [selectedBuilding.latitude, selectedBuilding.longitude],
          { animate: false }
        )
        if (isMobile) {
          map.panBy([0, Math.round(map.getSize().y * 0.22)], { animate: false })
        }
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [map, selectedBuilding, isMobile])

  return null
}

export default function CampusMap({ buildings, selectedBuilding, isMobile, onSelectBuilding }) {
  return (
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
        <MapUpdater selectedBuilding={selectedBuilding} isMobile={isMobile} />
        {buildings.map(building => (
          <Marker
            key={building.id}
            position={[building.latitude, building.longitude]}
            icon={getBuildingMarkerIcon(building)}
            eventHandlers={{ click: () => onSelectBuilding(building) }}
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
  )
}
