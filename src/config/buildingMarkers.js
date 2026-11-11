import { divIcon } from 'leaflet'

const buildingSymbol = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 20V4h10v16M4 20h16M10 8h4m-4 4h4m-4 4h4"/>
  </svg>
`

export const locationMarkerIcon = divIcon({
  className: 'location-marker',
  iconSize: [44, 44],
  html: '<span class="location-dot" aria-hidden="true"></span>',
})

export function getBuildingMarkerIcon(selected, zoom = 17, offset = [0, 0]) {
  const size = 28 + (19 - zoom) * 2 + (selected ? 6 : 0)
  return divIcon({
    className: `building-marker${selected ? ' building-marker-selected' : ''}`,
    iconSize: [size, size],
    // 建物は地点の少し上、現在地は地点の中心に表示する。
    iconAnchor: [size / 2 - offset[0], size + 8 - offset[1]],
    tooltipAnchor: [offset[0], offset[1] - size / 2 - 8],
    html: buildingSymbol,
  })
}
