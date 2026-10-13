import './App.css'
import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

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
      </MapContainer>
    </div>
  )
}

export default App