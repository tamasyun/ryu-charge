import { divIcon } from 'leaflet'

const buildingSymbol = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 20V4h10v16M4 20h16M10 8h4m-4 4h4m-4 4h4"/>
  </svg>
`

const marker = divIcon({
  className: 'building-marker',
  iconSize: [32, 32],
  html: buildingSymbol,
})

const selectedMarker = divIcon({
  className: 'building-marker building-marker-selected',
  iconSize: [40, 40],
  html: buildingSymbol,
})

export function getBuildingMarkerIcon(selected) {
  return selected ? selectedMarker : marker
}
