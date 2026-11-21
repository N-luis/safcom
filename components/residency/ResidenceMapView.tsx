'use client';

import { MapContainer, TileLayer, Marker, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { BARANGAY_CENTER } from '@/lib/geo';
import type { BoundaryGeometry } from '@/lib/jurisdiction';
import { boundaryRings, HOME_COLOR } from '@/components/forms/IncidentLocationMap';

const homeIcon = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${HOME_COLOR};border:2.5px solid #fff;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(12,30,70,.45)"><div style="transform:rotate(45deg);color:#fff;font:700 12px/23px sans-serif;text-align:center">H</div></div>`,
  iconSize: [28, 28], iconAnchor: [14, 28],
});

/**
 * An applicant's home location, for the verifier only: the pin and the
 * official boundary (when one is configured). Read-only - a verifier
 * compares, and never moves the resident's pin.
 */
export default function ResidenceMapView({ location, boundary, height = 280 }: {
  location: { latitude: number; longitude: number } | null; boundary: BoundaryGeometry | null; height?: number;
}) {
  const centre: [number, number] = location ? [location.latitude, location.longitude] : [BARANGAY_CENTER.lat, BARANGAY_CENTER.lng];
  return (
    <div style={{ height, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
      <MapContainer center={centre} zoom={17} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        {boundary && boundaryRings(boundary).map((ring, i) => (
          <Polygon key={i} positions={ring} pathOptions={{ color: '#0f766e', weight: 2, fillOpacity: 0.06, dashArray: '6 4' }} interactive={false} />
        ))}
        {location && <Marker position={[location.latitude, location.longitude]} icon={homeIcon} />}
      </MapContainer>
    </div>
  );
}
