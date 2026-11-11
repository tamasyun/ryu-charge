import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DomEvent, latLngBounds } from 'leaflet'
import { MapContainer, Marker, Pane, TileLayer, Tooltip, ZoomControl, useMap, useMapEvent, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './CampusMap.css'
import { getBuildingMarkerIcon, locationMarkerIcon } from '../../config/buildingMarkers'
import { layoutBuildingMarkers } from '../../utils/layoutBuildingMarkers'

const CAMPUS_CENTER = [26.2508, 127.7662]
const CAMPUS_BOUNDS = latLngBounds([26.241, 127.756], [26.257, 127.776])
const OVERVIEW_ZOOM = 16
const BUILDING_ZOOM = 17
const MAX_ZOOM = 19

function focusMapAt(map, position, isMobile, zoom = map.getZoom()) {
  const { x: width, y: height } = map.getSize()
  const offset = isMobile ? [0, Math.round(height * 0.22)] : [-Math.min(152, Math.round(width * 0.16)), -10]
  const center = map.unproject(map.project(position, zoom).add(offset), zoom)
  map.setView(center, zoom, { animate: false })
}

function MapView({ selectedBuilding, isMobile, overviewRequest }) {
  const map = useMap()
  const initialized = useRef(false)
  const lastOverviewRequest = useRef(overviewRequest)
  const zooming = useRef(false)
  const pendingView = useRef(null)
  const latitude = selectedBuilding?.latitude
  const longitude = selectedBuilding?.longitude

  useLayoutEffect(() => {
    if (initialized.current) return
    initialized.current = true
    focusMapAt(map, CAMPUS_CENTER, isMobile, OVERVIEW_ZOOM)
  }, [map, isMobile])

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
      else focusMapAt(map, [latitude, longitude], isMobile, Math.max(BUILDING_ZOOM, map.getZoom()))
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

function markerEvents(activate) {
  return {
    click: activate,
    keydown({ originalEvent }) {
      if (originalEvent.key !== 'Enter' && originalEvent.key !== ' ') return
      DomEvent.stop(originalEvent)
      activate()
    },
  }
}

function MapBuildings({ buildings, selectedBuilding, isMobile, onSelectBuilding }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  const updateZoom = useCallback(() => setZoom(map.getZoom()), [map])
  useMapEvent('zoomend', updateZoom)
  const markers = layoutBuildingMarkers(buildings)

  return (
    <>
      {markers.map(({ building, position: buildingPosition, offset }) => {
        const selected = building.id === selectedBuilding?.id
        return (
          <Marker
            key={building.id}
            position={buildingPosition}
            icon={getBuildingMarkerIcon(selected, zoom, offset)}
            title={building.name}
            alt={building.name}
            zIndexOffset={selected ? 1000 : 0}
            eventHandlers={markerEvents(() => onSelectBuilding(building))}
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
                <div>コンセント設備：合計 {building.rooms.reduce((total, room) => total + room.outlets.length, 0)} 件</div>
              </Tooltip>
            )}
          </Marker>
        )
      })}
    </>
  )
}

function MapLocation({ isMobile }) {
  const map = useMap()
  const [position, setPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')
  const watching = useRef(false)
  const focusOnFix = useRef(false)

  const startWatching = useCallback(() => {
    if (watching.current) return
    watching.current = true
    setLocating(true)
    setMessage('現在地を取得しています…')
    map.locate({ watch: true, setView: false, enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
  }, [map])

  useMapEvents({
    locationfound({ latlng }) {
      if (!watching.current) return
      setLocating(false)
      setPosition(latlng)
      if (!CAMPUS_BOUNDS.contains(latlng)) {
        focusOnFix.current = false
        setMessage('現在地は表示範囲外です')
        return
      }
      setMessage('')
      if (focusOnFix.current) {
        focusOnFix.current = false
        focusMapAt(map, latlng, isMobile, MAX_ZOOM)
      }
    },
    locationerror({ code }) {
      if (!watching.current) return
      focusOnFix.current = false
      setLocating(false)
      setMessage(code === 1 ? '位置情報の利用を許可してください' : '現在地を取得できませんでした')
      if (code === 1) {
        watching.current = false
        map.stopLocate()
        setPosition(null)
      }
    },
    movestart() { setMessage('') },
  })

  // 許可済みなら開始し、未許可の場合はボタンを押すまで権限を求めない。
  useEffect(() => {
    let active = true
    let permission
    function permissionChanged() {
      if (permission.state === 'granted') startWatching()
      else {
        watching.current = false
        focusOnFix.current = false
        map.stopLocate()
        setPosition(null)
        setLocating(false)
        setMessage('')
      }
    }
    async function checkPermission() {
      try {
        const status = await navigator.permissions?.query({ name: 'geolocation' })
        if (!active || !status) return
        permission = status
        permission.addEventListener('change', permissionChanged)
        if (permission.state === 'granted') startWatching()
      } catch {
        // 権限照会に未対応のブラウザーでは、ボタンから開始する。
      }
    }
    checkPermission()
    return () => {
      active = false
      permission?.removeEventListener('change', permissionChanged)
      watching.current = false
      focusOnFix.current = false
      map.stopLocate()
    }
  }, [map, startWatching])

  function locate() {
    if (position) {
      if (CAMPUS_BOUNDS.contains(position)) {
        setMessage('')
        focusMapAt(map, position, isMobile, MAX_ZOOM)
      } else setMessage('現在地は表示範囲外です')
    } else {
      watching.current = false
      map.stopLocate()
      focusOnFix.current = true
      startWatching()
    }
  }

  return (
    <>
      <Pane name="current-location" style={{ zIndex: 640 }}>
        {position && CAMPUS_BOUNDS.contains(position) && (
          <Marker
            position={position}
            icon={locationMarkerIcon}
            title="現在地を拡大"
            alt="現在地を拡大"
            eventHandlers={markerEvents(() => focusMapAt(map, position, isMobile, MAX_ZOOM))}
          >
            <Tooltip direction="bottom" offset={[0, 12]} opacity={1} className="building-label">
              現在地
            </Tooltip>
          </Marker>
        )}
      </Pane>
      <div className="map-location" ref={preventMapDrag}>
        <button type="button" aria-label="現在地を拡大して表示" title="現在地を拡大して表示" onClick={locate} disabled={locating} aria-busy={locating}>
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
        center={CAMPUS_CENTER}
        zoom={OVERVIEW_ZOOM}
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
        <MapBuildings buildings={buildings} selectedBuilding={selectedBuilding} isMobile={isMobile} onSelectBuilding={onSelectBuilding} />
        <MapLocation isMobile={isMobile} />
      </MapContainer>
    </section>
  )
}
