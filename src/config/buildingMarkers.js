
import { icon } from 'leaflet'
import buildingMarkerUrl from '../assets/markers/building-marker.svg'

// 共通設定
const markerOptions = {
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  popupAnchor: [0, -24],
}

// アイコンを生成する
function createMarkerIcon(url) {
  return icon({
    iconUrl: url,
    ...markerOptions,
  })
}

// アイコン一覧
const markerIcons = {
  building: createMarkerIcon(buildingMarkerUrl),
}

// 建物ごとのアイコン設定
const buildingIconTypes = {
  'building-1': 'building',
  'building-2': 'building',
  'building-003': 'building',
}

// 建物に対応するアイコンを取得
export function getBuildingMarkerIcon(building) {
  const type = buildingIconTypes[building.id] ?? 'building'
  return markerIcons[type] ?? markerIcons.building
}
