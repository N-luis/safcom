'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Box, Typography, Button } from '@mui/material';
import { useRouter } from 'next/navigation';

// ─── Shared types ────────────────────────────────────────────────────────────

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Escalated';
export type CaseStatus = 'Pending' | 'Under Review' | 'Ongoing' | 'Resolved';
export type CaseCategory = 'VAWC' | 'Criminal' | 'Civil Dispute';

export interface CaseData {
  id: string;
  category: CaseCategory;
  status: CaseStatus;
  riskLevel: RiskLevel;
  barangay: string;
  latitude: number;
  longitude: number;
  reportedDate: string;
}

// ─── Color maps ──────────────────────────────────────────────────────────────

export const RISK_COLORS: Record<string, string> = {
  Low: '#22c55e',
  Medium: '#f97316',
  High: '#ef4444',
  Escalated: '#7c3aed',
};

export const STATUS_COLORS: Record<string, string> = {
  Pending: '#f97316',
  'Under Review': '#3b82f6',
  Ongoing: '#8b5cf6',
  Resolved: '#22c55e',
};

export const CATEGORY_COLORS: Record<string, string> = {
  VAWC: '#7c3aed',
  Criminal: '#ef4444',
  'Civil Dispute': '#3b82f6',
};

const RISK_INTENSITY: Record<string, number> = {
  Low: 0.25,
  Medium: 0.5,
  High: 0.8,
  Escalated: 1.0,
};

// ─── Map constants ───────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [14.8020, 120.9085]; // Bocaue, Bulacan
const MAP_ZOOM = 14;

// ─── Custom marker icon ──────────────────────────────────────────────────────

function createMarkerIcon(riskLevel: string, selected: boolean): L.DivIcon {
  const color = RISK_COLORS[riskLevel] ?? '#64748b';
  const size = selected ? 20 : 14;
  const border = selected ? `3px solid #fff` : '2px solid #fff';
  const outerSize = size + 14;
  const pulseHtml =
    riskLevel === 'Escalated'
      ? `<div class="lm-pulse" style="position:absolute;inset:-8px;border-radius:50%;background:${color};opacity:0.22;pointer-events:none;"></div>`
      : '';
  const ring = selected
    ? `<div style="position:absolute;inset:-5px;border-radius:50%;border:2.5px solid ${color};opacity:0.55;pointer-events:none;"></div>`
    : '';
  return L.divIcon({
    html: `
      <div style="position:relative;width:${outerSize}px;height:${outerSize}px;display:flex;align-items:center;justify-content:center;">
        ${pulseHtml}
        ${ring}
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};border:${border};
          box-shadow:0 2px 6px rgba(0,0,0,0.35);
          position:relative;z-index:1;
        "></div>
      </div>`,
    className: '',
    iconSize: [outerSize, outerSize],
    iconAnchor: [outerSize / 2, outerSize / 2],
    popupAnchor: [0, -(outerSize / 2 + 4)],
  });
}

// ─── Heat layer sub-component ────────────────────────────────────────────────

type HeatLayer = L.Layer & { setLatLngs(pts: [number, number, number][]): void };

// Module-level flag — leaflet.heat only needs to be imported once per session
let heatPluginLoaded = false;

function HeatLayerRenderer({ cases }: { cases: CaseData[] }) {
  const map = useMap();
  const layerRef = useRef<HeatLayer | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current as L.Layer);
      layerRef.current = null;
    }

    if (!cases.length) return;

    const points: [number, number, number][] = cases.map(c => [
      c.latitude,
      c.longitude,
      RISK_INTENSITY[c.riskLevel] ?? 0.5,
    ]);

    const HEAT_OPTIONS = {
      radius: 35,
      blur: 25,
      minOpacity: 0.35,
      gradient: { 0.25: '#22c55e', 0.5: '#f97316', 0.8: '#ef4444', 1.0: '#7c3aed' },
    };

    const applyLayer = () => {
      if (!aliveRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heat = (L as any).heatLayer(points, HEAT_OPTIONS) as HeatLayer;
      heat.addTo(map);
      layerRef.current = heat;
    };

    if (heatPluginLoaded) {
      applyLayer();
    } else {
      // leaflet.heat is a UMD build that expects window.L — set it before importing
      (window as unknown as Record<string, unknown>).L = L;
      import('leaflet.heat').then(() => {
        heatPluginLoaded = true;
        applyLayer();
      });
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current as L.Layer);
        layerRef.current = null;
      }
    };
  }, [cases, map]);

  return null;
}

// ─── Tile-size fix helper ────────────────────────────────────────────────────

function MapReady() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface CasesMapProps {
  cases: CaseData[];
  selectedCaseId: string | null;
  onCaseSelect: (c: CaseData) => void;
  showHeatmap: boolean;
  mapHeight?: string | number;
}

export default function CasesMap({
  cases,
  selectedCaseId,
  onCaseSelect,
  showHeatmap,
  mapHeight = '100%',
}: CasesMapProps) {
  const router = useRouter();

  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      style={{ height: mapHeight, width: '100%', borderRadius: 'inherit' }}
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapReady />
      {showHeatmap && <HeatLayerRenderer cases={cases} />}

      {cases.map(c => (
        <Marker
          key={c.id}
          position={[c.latitude, c.longitude]}
          icon={createMarkerIcon(c.riskLevel, c.id === selectedCaseId)}
          zIndexOffset={c.id === selectedCaseId ? 1000 : 0}
          eventHandlers={{ click: () => onCaseSelect(c) }}
        >
          <Popup closeButton={false} minWidth={185}>
            <Box sx={{ fontFamily: 'Inter, sans-serif', py: 0.25 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.94rem', mb: 0.75, color: '#0c1e46' }}>
                {c.id}
              </Typography>
              <Box sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 2, mb: 1 }}>
                <Box component="div"><strong>Category:</strong>{' '}
                  <span style={{ color: CATEGORY_COLORS[c.category], fontWeight: 600 }}>{c.category}</span>
                </Box>
                <Box component="div"><strong>Barangay:</strong> {c.barangay}</Box>
                <Box component="div"><strong>Status:</strong>{' '}
                  <span style={{ color: STATUS_COLORS[c.status], fontWeight: 600 }}>{c.status}</span>
                </Box>
                <Box component="div"><strong>Risk Level:</strong>{' '}
                  <span style={{ color: RISK_COLORS[c.riskLevel], fontWeight: 700 }}>{c.riskLevel}</span>
                </Box>
              </Box>
              <Button
                size="small"
                variant="contained"
                fullWidth
                onClick={() => router.push(`/blotter-officer/case-management?highlight=${c.id}`)}
                sx={{
                  fontSize: '0.78rem', py: 0.5, textTransform: 'none',
                  bgcolor: '#3b82f6', '&:hover': { bgcolor: '#1d4ed8' },
                  borderRadius: 1.5, fontWeight: 700,
                }}
              >
                View Full Case
              </Button>
            </Box>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
