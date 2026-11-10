import { useEffect, useRef, useState } from 'react'
import { DomEvent, latLngBounds } from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './CampusMap.css'
import { getBuildingMarkerIcon } from '../../config/buildingMarkers'

const CAMPUS_CENTER = [26.2508, 127.7662]
const CAMPUS_BOUNDS = latLngBounds([26.241, 127.756], [26.257, 127.776])
const OVERVIEW_ZOOM = 16
const INITIAL_ZOOM = 17
const MAX_ZOOM = 19

function focusMapAt(map, position, isMobile, zoom = map.getZoom()) {
  const { x: width, y: height } = map.getSize()
  const offset = isMobile ? [0, Math.round(height * 0.22)] : [-Math.min(152, Math.round(width * 0.16)), -10]
  const center = map.unproject(map.project(position, zoom).add(offset), zoom)
  map.setView(center, zoom, { animate: false })
}

function MapView({ selectedBuilding, isMobile, overviewRequest }) {
  const map = useMap()
  const lastOverviewRequest = useRef(overviewRequest)
  const zooming = useRef(false)
  const pendingView = useRef(null)
  const latitude = selectedBuilding?.latitude
  const longitude = selectedBuilding?.longitude

  useMapEvents({
    zoomstart() { zooming.current = true },
    zoomend() {
      const move = pendingView.current
      zooming.current = false
      pendingView.current = null
      if (move) move()
      else if (!selectedBuilding && map.getZoom() === OVERVIEW_ZOOM) {
        focusMapAt(map, CAMPUS_CENTER, isMobile, OVERVIEW_ZOOM)
      }
    },
  })

  useEffect(() => {
    const reset = lastOverviewRequest.current !== overviewRequest
    lastOverviewRequest.current = overviewRequest
    pendingView.current = null
    if (!reset && (latitude == null || longitude == null)) return

    function move() {
      if (reset) focusMapAt(map, CAMPUS_CENTER, isMobile, OVERVIEW_ZOOM)
      else focusMapAt(map, [latitude, longitude], isMobile, Math.max(INITIAL_ZOOM, map.getZoom()))
    }

    // 拡大・縮小の途中で押された操作は、アニメーションの完了後に反映する。
    if (zooming.current) pendingView.current = move
    else move()
  }, [map, isMobile, latitude, longitude, overviewRequest])

  return null
}

function preventMapDrag(node) {
  if (!node) return
  DomEvent.disableClickPropagation(node)
  return () => DomEvent.off(node)
}

function MapLocation({ isMobile }) {
  const map = useMap()
  const [position, setPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')

  useMapEvents({
    locationfound({ latlng }) {
      setLocating(false)
      if (!CAMPUS_BOUNDS.contains(latlng)) {
        setMessage('現在地は表示範囲外です')
        return
      }
      setPosition(latlng)
      focusMapAt(map, latlng, isMobile)
    },
    locationerror() {
      setLocating(false)
      setMessage('現在地を取得できませんでした')
    },
    movestart() { setMessage('') },
  })

  function locate() {
    setLocating(true)
    setMessage('')
    setPosition(null)
    map.locate({ setView: false, timeout: 10_000, maximumAge: 15_000 })
  }

  return (
    <>
      {position && (
        <CircleMarker
          center={position}
          radius={7}
          className="location-dot"
          pathOptions={{ color: '#fff', weight: 2, fillColor: '#0065cf', fillOpacity: 1 }}
          interactive={false}
        />
      )}
      <div className="map-location" ref={preventMapDrag}>
        <button type="button" aria-label="現在地を表示" title="現在地を表示" onClick={locate} disabled={locating}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.8 10.1l7.3 2.8 2.8 7.3 6.6-16.7Z" /></svg>
        </button>
        <p role="status" className="map-location-status">{message}</p>
      </div>
    </>
  )
}

export default function CampusMap({ buildings, selectedBuilding, isMobile, overviewRequest, onSelectBuilding }) {
  return (
    <section className="map-area" aria-label="キャンパスの地図">
      <MapContainer
        className="campus-map"
        center={isMobile ? [26.2499, 127.7662] : [26.2508, 127.7651]}
        zoom={INITIAL_ZOOM}
        minZoom={OVERVIEW_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={CAMPUS_BOUNDS}
        maxBoundsViscosity={1}
        bounceAtZoomLimits={false}
        zoomControl={false}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={MAX_ZOOM}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        />
        <ZoomControl position="bottomright" zoomInTitle="地図を拡大" zoomOutTitle="地図を縮小" />
        <MapView selectedBuilding={selectedBuilding} isMobile={isMobile} overviewRequest={overviewRequest} />
        <MapLocation isMobile={isMobile} />
        {buildings.map(building => {
          const selected = building.id === selectedBuilding?.id
          return (
            <Marker
              key={building.id}
              position={[building.latitude, building.longitude]}
              icon={getBuildingMarkerIcon(selected)}
              title={building.name}
              zIndexOffset={selected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectBuilding(building) }}
            >
              {selected && (
                <Tooltip
                  permanent
                  direction={isMobile ? 'top' : 'right'}
                  offset={isMobile ? [0, -24] : [23, 0]}
                  opacity={1}
                  className="building-label"
                >
                  <strong>{building.name}</strong>
                  <div>
                    コンセント設備：合計 {
                      building.rooms.reduce((total, room) => total + room.outlets.length, 0)
                    } 件
                  </div>
                </Tooltip>
              )}
            </Marker>
          )
        })}
      </MapContainer>
    </section>
  )
}
