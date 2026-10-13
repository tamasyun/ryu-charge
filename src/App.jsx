import './App.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import spotsData from './data/spots.json'

function App() {
  return (
    <div>
      <h1>琉CHARGE</h1>
     <MapContainer
        center={[26.2524, 127.7659]}
        zoom={16}
        style={{ height: '70vh', width: '100%' }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {spotsData.spots.map((spot) => (
          <Marker
            key={spot.id}
            position={[spot.latitude, spot.longitude]}
          >
            <Popup>
              <strong>{spot.name}</strong>
              <p>{spot.building_name}</p>
              <p>コンセント設備：{spot.outlets.length}件</p>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

export default App