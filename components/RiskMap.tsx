'use client';

// Dynamically loaded with ssr:false — Leaflet requires browser window / document.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup,
  Circle, useMap, AttributionControl, ScaleControl,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import {
  Box, Typography, Chip, Select, MenuItem, Paper,
  Divider, Tooltip, IconButton, LinearProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Alert,
} from '@mui/material';
import {
  Warning, OpenInNew, ZoomIn, ZoomOut, MyLocation,
  Fullscreen, FullscreenExit, CenterFocusStrong,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MapCase {
  id: string;
  caseNumber: string;
  caseType: string;
  barangay: string;
  status: string;
  score: number;
  level: 'High' | 'Medium' | 'Low';
  filedAt: string;
}

export interface MapArea {
  barangay: string;
  total: number;
  highRisk: number;
  avgScore: number;
  dominantCaseTypes?: string[];
}

// ─── Internal type ────────────────────────────────────────────────────────────

interface DisplayCase extends MapCase {
  lat: number;
  lng: number;
  isSample: boolean;
}

// ─── Geographic constants — Biñan 2nd, Bocaue, Bulacan ───────────────────────
// Bocaue municipality center: 14°47'46"N 120°54'44"E = [14.7961, 120.9122]
// Biñan 2nd is in the northern section of Bocaue → shift north ~0.006°

const CENTER: [number, number] = [14.8020, 120.9085];
const DEFAULT_ZOOM = 16;
const MIN_ZOOM = 14;
const MAX_ZOOM = 19;

// Bounds encompass northern Bocaue + small buffer — keeps view inside the municipality
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [14.784, 120.893],
  [14.821, 120.928],
];

// ─── Risk colour palette ──────────────────────────────────────────────────────

const RISK = {
  High:   { color: '#ef4444', light: '#fee2e2', border: '#fca5a5', label: 'High Risk'   },
  Medium: { color: '#f97316', light: '#fff7ed', border: '#fdba74', label: 'Medium Risk' },
  Low:    { color: '#22c55e', light: '#f0fdf4', border: '#86efac', label: 'Low Risk'    },
} as const;

// ─── Named locations within Biñan 2nd (Bocaue, Bulacan) ─────────────────────

const LOC: Record<string, [number, number]> = {
  'purok 1':       [14.8038, 120.9068],
  'purok 2':       [14.8026, 120.9090],
  'purok 3':       [14.8011, 120.9073],
  'purok 4':       [14.8032, 120.9100],
  'purok 5':       [14.8007, 120.9062],
  'main road':     [14.8021, 120.9083],
  'market area':   [14.8001, 120.9098],
  'market':        [14.8001, 120.9098],
  'chapel':        [14.8028, 120.9079],
  'chapel area':   [14.8028, 120.9079],
  'barangay hall': [14.8018, 120.9082],
  'sitio':         [14.8005, 120.9065],
  'biñan 2nd':     [14.8020, 120.9085],
  'binan 2nd':     [14.8020, 120.9085],
  'binang 2nd':    [14.8020, 120.9085],
  'bocaue':        [14.7961, 120.9122],
};

// ─── Sample incident data — 15 cases spread across Biñan 2nd ─────────────────

const DEMO_CASES: DisplayCase[] = [
  // ── Purok 1 cluster (NW — highest risk zone)
  { id: 'D01', caseNumber: 'C-2025-001', caseType: 'Physical Assault',      level: 'High',   status: 'Open',                score: 84, barangay: 'Purok 1',     lat: 14.8040, lng: 120.9064, filedAt: '2025-01-10', isSample: true },
  { id: 'D02', caseNumber: 'C-2025-002', caseType: 'Domestic Violence',     level: 'High',   status: 'Under Investigation', score: 91, barangay: 'Purok 1',     lat: 14.8035, lng: 120.9071, filedAt: '2025-01-22', isSample: true },
  { id: 'D13', caseNumber: 'C-2025-013', caseType: 'Drug Peddling',         level: 'High',   status: 'Under Investigation', score: 93, barangay: 'Purok 1',     lat: 14.8043, lng: 120.9073, filedAt: '2025-03-12', isSample: true },
  // ── Purok 2 (N center)
  { id: 'D03', caseNumber: 'C-2025-003', caseType: 'Drug Use',              level: 'High',   status: 'Under Investigation', score: 88, barangay: 'Purok 2',     lat: 14.8029, lng: 120.9092, filedAt: '2025-02-08', isSample: true },
  { id: 'D12', caseNumber: 'C-2025-012', caseType: 'Physical Assault',      level: 'High',   status: 'Open',                score: 79, barangay: 'Purok 2',     lat: 14.8024, lng: 120.9094, filedAt: '2025-03-01', isSample: true },
  // ── Main Road
  { id: 'D04', caseNumber: 'C-2025-004', caseType: 'Verbal Abuse',          level: 'Medium', status: 'Under Investigation', score: 57, barangay: 'Main Road',   lat: 14.8023, lng: 120.9081, filedAt: '2025-01-12', isSample: true },
  { id: 'D05', caseNumber: 'C-2025-005', caseType: 'Harassment',            level: 'Medium', status: 'Pending Resolution',  score: 52, barangay: 'Main Road',   lat: 14.8017, lng: 120.9076, filedAt: '2025-01-28', isSample: true },
  { id: 'D14', caseNumber: 'C-2025-014', caseType: 'Domestic Violence',     level: 'Medium', status: 'Pending Resolution',  score: 61, barangay: 'Chapel Area', lat: 14.8030, lng: 120.9080, filedAt: '2025-03-18', isSample: true },
  // ── Purok 3 (center)
  { id: 'D06', caseNumber: 'C-2025-006', caseType: 'Domestic Dispute',      level: 'High',   status: 'In Progress',         score: 76, barangay: 'Purok 3',     lat: 14.8013, lng: 120.9070, filedAt: '2025-01-15', isSample: true },
  { id: 'D10', caseNumber: 'C-2025-010', caseType: 'Vandalism',             level: 'Medium', status: 'Open',                score: 43, barangay: 'Purok 3',     lat: 14.8009, lng: 120.9078, filedAt: '2025-03-05', isSample: true },
  // ── Market Area (E)
  { id: 'D07', caseNumber: 'C-2025-007', caseType: 'Theft',                 level: 'Medium', status: 'Open',                score: 49, barangay: 'Market Area', lat: 14.8003, lng: 120.9099, filedAt: '2025-01-18', isSample: true },
  { id: 'D08', caseNumber: 'C-2025-008', caseType: 'Illegal Gambling',      level: 'Low',    status: 'Resolved',            score: 31, barangay: 'Market Area', lat: 14.7998, lng: 120.9103, filedAt: '2025-02-03', isSample: true },
  // ── Purok 4 / Purok 5 / outliers
  { id: 'D11', caseNumber: 'C-2025-011', caseType: 'Trespassing',           level: 'Low',    status: 'Resolved',            score: 22, barangay: 'Purok 4',     lat: 14.8034, lng: 120.9103, filedAt: '2025-02-18', isSample: true },
  { id: 'D09', caseNumber: 'C-2025-009', caseType: 'Community Disturbance', level: 'Low',    status: 'Resolved',            score: 27, barangay: 'Purok 5',     lat: 14.8008, lng: 120.9061, filedAt: '2025-01-20', isSample: true },
  { id: 'D15', caseNumber: 'C-2025-015', caseType: 'Noise Complaint',       level: 'Low',    status: 'Resolved',            score: 18, barangay: 'Purok 5',     lat: 14.8004, lng: 120.9066, filedAt: '2025-04-02', isSample: true },
];

const DEMO_AREAS: MapArea[] = [
  { barangay: 'Purok 1',     total: 3, highRisk: 3, avgScore: 89, dominantCaseTypes: ['Physical Assault', 'Drug Peddling', 'Domestic Violence'] },
  { barangay: 'Purok 2',     total: 2, highRisk: 2, avgScore: 84, dominantCaseTypes: ['Drug Use', 'Physical Assault'] },
  { barangay: 'Purok 3',     total: 2, highRisk: 1, avgScore: 60, dominantCaseTypes: ['Domestic Dispute', 'Vandalism'] },
  { barangay: 'Chapel Area', total: 1, highRisk: 0, avgScore: 61, dominantCaseTypes: ['Domestic Violence'] },
  { barangay: 'Main Road',   total: 2, highRisk: 0, avgScore: 55, dominantCaseTypes: ['Verbal Abuse', 'Harassment'] },
  { barangay: 'Market Area', total: 2, highRisk: 0, avgScore: 40, dominantCaseTypes: ['Theft', 'Illegal Gambling'] },
  { barangay: 'Purok 4',     total: 1, highRisk: 0, avgScore: 22, dominantCaseTypes: ['Trespassing'] },
  { barangay: 'Purok 5',     total: 2, highRisk: 0, avgScore: 23, dominantCaseTypes: ['Community Disturbance', 'Noise Complaint'] },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function jitterCoord(base: [number, number], seed: string): [number, number] {
  const j = fnv32(seed);
  return [
    base[0] + ((j & 0xFF) / 0xFF - 0.5) * 0.001,
    base[1] + (((j >> 8) & 0xFF) / 0xFF - 0.5) * 0.001,
  ];
}

function resolveCase(street: string, id: string): [number, number] {
  const k = street.toLowerCase().trim();
  if (LOC[k]) return jitterCoord(LOC[k], id);
  for (const [key, coord] of Object.entries(LOC)) {
    if (k.includes(key) || key.includes(k)) return jitterCoord(coord, id);
  }
  const sh = fnv32(k), jh = fnv32(id);
  return [
    CENTER[0] + ((sh & 0xFFFF) / 0xFFFF - 0.5) * 0.005 + ((jh & 0xFF) / 0xFF - 0.5) * 0.001,
    CENTER[1] + ((sh >>> 16) / 0xFFFF - 0.5) * 0.005 + (((jh >> 8) & 0xFF) / 0xFF - 0.5) * 0.001,
  ];
}

function resolveArea(street: string): [number, number] {
  const k = street.toLowerCase().trim();
  if (LOC[k]) return LOC[k];
  for (const [key, coord] of Object.entries(LOC)) {
    if (k.includes(key) || key.includes(k)) return coord;
  }
  const sh = fnv32(k);
  return [CENTER[0] + ((sh & 0xFFFF) / 0xFFFF - 0.5) * 0.005, CENTER[1] + ((sh >>> 16) / 0xFFFF - 0.5) * 0.005];
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── Leaflet icon factories ───────────────────────────────────────────────────

function dotIcon(level: string, isHighlight = false, isSample = false): L.DivIcon {
  const r = RISK[level as keyof typeof RISK] ?? { color: '#94a3b8', light: '#f8fafc', border: '#cbd5e1', label: level };
  const size   = isHighlight ? 20 : 15;
  const pulse  = isHighlight ? ' lm-pulse' : '';
  const border = `border: 2.5px solid ${r.color}`;
  const bg     = `background: ${r.light}`;
  const dot    = Math.round(size * 0.38);
  return L.divIcon({
    className: '',
    html: `<div class="${pulse}" style="width:${size}px;height:${size}px;border-radius:50%;${bg};${border};display:flex;align-items:center;justify-content:center;opacity:${isSample ? 0.78 : 1};cursor:pointer;transition:transform .15s;" onmouseover="this.style.transform='scale(1.3)'" onmouseout="this.style.transform='scale(1)'"><div style="width:${dot}px;height:${dot}px;border-radius:50%;background:${r.color};"></div></div>`,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 8)],
  });
}

function clusterIcon(cluster: { getChildCount: () => number }): L.DivIcon {
  const n  = cluster.getChildCount();
  const sz = n < 10 ? 32 : n < 30 ? 38 : 46;
  const bg = n >= 20 ? '#dc2626' : n >= 8 ? '#ea580c' : '#0c1e46';
  const fs = sz < 36 ? 12 : 14;
  return L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${bg};color:white;display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:900;box-shadow:0 4px 18px ${bg}66;border:2.5px solid rgba(255,255,255,0.9);">${n}</div>`,
    iconSize:   [sz, sz],
    iconAnchor: [sz / 2, sz / 2],
  });
}

// ─── In-map sub-components ────────────────────────────────────────────────────

/** Forces the map to recalculate its size after mount — fixes broken tile rendering */
function MapInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

/** Stores the map instance in a ref so the outer component can call map methods */
function CaptureMap({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

function ZoomBtns() {
  const map = useMap();
  return (
    <Box sx={{ position: 'absolute', bottom: 72, right: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {[
        { title: 'Zoom in',  Icon: ZoomIn,  fn: () => map.zoomIn()  },
        { title: 'Zoom out', Icon: ZoomOut, fn: () => map.zoomOut() },
      ].map(({ title, Icon, fn }) => (
        <Tooltip key={title} title={title} placement="left">
          <Paper elevation={4} onClick={fn} sx={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '8px', bgcolor: 'white', transition: 'all .15s', '&:hover': { bgcolor: '#f1f5f9', transform: 'scale(1.1)' } }}>
            <Icon sx={{ fontSize: 15, color: '#374151' }} />
          </Paper>
        </Tooltip>
      ))}
    </Box>
  );
}

function ReCenter({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip title="Re-centre — Biñan 2nd, Bocaue" placement="right">
      <Paper elevation={4} onClick={onClick} sx={{ position: 'absolute', bottom: 72, left: 12, zIndex: 1000, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '8px', bgcolor: 'white', transition: 'all .15s', '&:hover': { bgcolor: '#f1f5f9', transform: 'scale(1.1)' } }}>
        <MyLocation sx={{ fontSize: 14, color: '#374151' }} />
      </Paper>
    </Tooltip>
  );
}

function FitAll({ positions, trigger }: { positions: [number, number][]; trigger: number }) {
  const map = useMap();
  useEffect(() => {
    if (trigger > 0 && positions.length > 0) {
      map.fitBounds(positions, { padding: [48, 48], maxZoom: MAX_ZOOM - 1, animate: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

// ─── Popups (plain HTML — safe inside Leaflet portal) ────────────────────────

function CasePopup({ c, onNavigate }: { c: DisplayCase; onNavigate: (id: string) => void }) {
  const r = RISK[c.level] ?? { color: '#94a3b8', light: '#f8fafc', border: '#e2e8f0', label: c.level };
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minWidth: 230, maxWidth: 280 }}>
      {/* Header bar */}
      <div style={{ background: `linear-gradient(135deg, ${r.color}18, ${r.color}08)`, borderBottom: `2px solid ${r.color}22`, padding: '10px 12px 8px', margin: '-4px -4px 10px', borderRadius: '6px 6px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontWeight: 900, fontSize: 16, color: '#0c1e46', letterSpacing: '-0.02em' }}>#{c.caseNumber}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: r.light, color: r.color, border: `1px solid ${r.border}` }}>
            {r.label}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{c.caseType}</div>
      </div>

      {/* Details */}
      <div style={{ padding: '0 2px', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
          <span>📍</span><span>{c.barangay}, Biñan 2nd, Bocaue, Bulacan</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
          <span>📅</span><span>Filed {fmtDate(c.filedAt)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#64748b' }}>
          <span>📋</span>
          <span>Status: <strong style={{ color: '#374151' }}>{c.status}</strong></span>
        </div>
        {c.isSample && (
          <div style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic', marginTop: 1 }}>⚡ Sample / demo incident</div>
        )}
      </div>

      {/* AI Risk Score bar */}
      <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>AI Risk Score</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: r.color }}>{c.score}<span style={{ fontSize: 9, fontWeight: 600, color: '#94a3b8' }}>/100</span></span>
        </div>
        <div style={{ height: 7, borderRadius: 7, background: '#e2e8f0', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${c.score}%`, borderRadius: 7, background: `linear-gradient(90deg, ${r.color}80, ${r.color})` }} />
        </div>
      </div>

      {!c.isSample && (
        <button
          onClick={() => onNavigate(c.id)}
          style={{ width: '100%', padding: '9px 12px', border: 'none', borderRadius: 10, background: 'linear-gradient(135deg,#0c1e46,#1e3a6e)', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <span>View Full Case Record</span><span style={{ fontSize: 14 }}>↗</span>
        </button>
      )}
    </div>
  );
}

function AreaPopup({ area }: { area: MapArea }) {
  const col   = area.avgScore >= 65 ? '#ef4444' : area.avgScore >= 40 ? '#f97316' : '#22c55e';
  const label = area.avgScore >= 65 ? 'HIGH RISK ZONE' : area.avgScore >= 40 ? 'MEDIUM RISK' : 'LOW RISK';
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minWidth: 210, padding: '2px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${col}18` }}>
        {area.avgScore >= 65 && <span style={{ fontSize: 15 }}>⚠️</span>}
        <span style={{ fontWeight: 800, fontSize: 14, color: '#0c1e46', flex: 1 }}>{area.barangay}</span>
        <span style={{ fontSize: 9, padding: '3px 8px', borderRadius: 20, background: `${col}15`, color: col, fontWeight: 800, letterSpacing: '.04em' }}>{label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        {[
          { label: 'Cases',    val: String(area.total),        color: '#374151' },
          { label: 'High Risk',val: String(area.highRisk),     color: area.highRisk > 0 ? '#ef4444' : '#94a3b8' },
          { label: 'Avg Score',val: `${area.avgScore}`,        color: col },
        ].map(({ label: lbl, val, color: vc }) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{lbl}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: vc }}>{val}</div>
          </div>
        ))}
      </div>
      {area.dominantCaseTypes && area.dominantCaseTypes.length > 0 && (
        <div style={{ fontSize: 10, color: '#64748b', paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
          Dominant: <strong style={{ color: '#374151' }}>{area.dominantCaseTypes.slice(0, 2).join(' · ')}</strong>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RiskMapProps {
  cases: MapCase[];
  areas: MapArea[];
}

type LayerMode = 'markers' | 'heatmap' | 'zones';
type TimeRange = 'today' | '7d' | '30d' | 'all';

export default function RiskMap({ cases, areas }: RiskMapProps) {
  const router       = useRouter();
  const mapRef       = useRef<L.Map | null>(null);
  const isSampleMode = cases.length === 0;

  const [layer,        setLayer]        = useState<LayerMode>('markers');
  const [view,         setView]         = useState<'map' | 'table'>('map');
  const [filterRisk,   setFilterRisk]   = useState('');
  const [filterType,   setFilterType]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [timeRange,    setTimeRange]    = useState<TimeRange>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitTrigger,   setFitTrigger]   = useState(0);

  // Invalidate map size on fullscreen change
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize({ animate: false }), 120);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  const realCases = useMemo<DisplayCase[]>(() =>
    cases.map(c => ({ ...c, lat: resolveCase(c.barangay, c.id)[0], lng: resolveCase(c.barangay, c.id)[1], isSample: false })),
  [cases]);

  const displayCases = isSampleMode ? DEMO_CASES : realCases;
  const displayAreas = isSampleMode ? DEMO_AREAS : areas;

  const filtered = useMemo(() => {
    const cutoff = timeRange === 'today' ? daysAgo(0)
      : timeRange === '7d'   ? daysAgo(7)
      : timeRange === '30d'  ? daysAgo(30)
      : null;

    return displayCases.filter(c => {
      if (filterRisk   && c.level    !== filterRisk)   return false;
      if (filterType   && c.caseType !== filterType)   return false;
      if (filterStatus && c.status   !== filterStatus) return false;
      if (cutoff && new Date(c.filedAt) < cutoff)      return false;
      return true;
    });
  }, [displayCases, filterRisk, filterType, filterStatus, timeRange]);

  const caseTypes = useMemo(() => Array.from(new Set(displayCases.map(c => c.caseType))).sort(), [displayCases]);
  const statuses  = useMemo(() => Array.from(new Set(displayCases.map(c => c.status))).sort(),   [displayCases]);

  const counts = useMemo(() => ({
    high:   filtered.filter(c => c.level === 'High').length,
    medium: filtered.filter(c => c.level === 'Medium').length,
    low:    filtered.filter(c => c.level === 'Low').length,
  }), [filtered]);

  const positions = useMemo<[number, number][]>(() =>
    filtered.map(c => [c.lat, c.lng]),
  [filtered]);

  const highRiskAreas = useMemo(() => displayAreas.filter(a => a.avgScore >= 65), [displayAreas]);

  const clearFilters = useCallback(() => {
    setFilterRisk(''); setFilterType(''); setFilterStatus(''); setTimeRange('all');
  }, []);
  const hasFilters = !!(filterRisk || filterType || filterStatus || timeRange !== 'all');

  const navigate = useCallback((id: string) =>
    router.push(`/blotter-officer/case-management/${id}`), [router]);

  const reCentre = useCallback(() =>
    mapRef.current?.flyTo(CENTER, DEFAULT_ZOOM, { duration: 0.9 }), []);

  const mapHeight = isFullscreen ? 'calc(100vh - 130px)' : 500;

  return (
    <Box sx={{
      borderRadius: isFullscreen ? 0 : 2,
      overflow: 'hidden',
      border: '1px solid #e2e8f0',
      ...(isFullscreen ? {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9998, bgcolor: 'white',
      } : {}),
    }}>
      {/* Demo mode banner */}
      {isSampleMode && (
        <Alert severity="info" icon={false} sx={{ borderRadius: 0, borderBottom: '1px solid #bae6fd', py: 0.6, '& .MuiAlert-message': { fontSize: '0.82rem', width: '100%' } }}>
          <strong>Demo Mode</strong> — Showing 15 sample incidents across Biñan 2nd, Bocaue, Bulacan. Submit real cases to populate live data.
        </Alert>
      )}

      {/* ── Toolbar ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center', px: 2, py: 1.25, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>

        {/* View toggle */}
        <Box sx={{ display: 'flex', bgcolor: 'white', borderRadius: 1.5, border: '1px solid #e2e8f0', p: '2px', gap: '2px', flexShrink: 0 }}>
          {(['map', 'table'] as const).map(v => (
            <Box key={v} onClick={() => setView(v)} sx={{ px: 1.5, py: 0.5, borderRadius: 1.25, cursor: 'pointer', bgcolor: view === v ? '#0c1e46' : 'transparent', transition: 'all .15s' }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: view === v ? 'white' : '#94a3b8', userSelect: 'none' }}>
                {v === 'map' ? '🗺 Map' : '📊 Table'}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Layer toggles (map only) */}
        {view === 'map' && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {([
              { k: 'markers' as const, label: '📍 Incidents'  },
              { k: 'heatmap' as const, label: '🌡 Heat Map'   },
              { k: 'zones'   as const, label: '⚠ Risk Zones' },
            ]).map(({ k, label }) => (
              <Chip key={k} label={label} size="small" onClick={() => setLayer(k)}
                sx={{ fontWeight: 700, fontSize: '0.78rem', height: 26, cursor: 'pointer',
                  bgcolor: layer === k ? '#0c1e46' : 'white',
                  color:   layer === k ? 'white'   : '#64748b',
                  border: `1px solid ${layer === k ? '#0c1e46' : '#e2e8f0'}`,
                }} />
            ))}
          </Box>
        )}

        {/* Time range (map only) */}
        {view === 'map' && (
          <Box sx={{ display: 'flex', gap: 0.4 }}>
            {([
              { v: 'today' as const, label: 'Today'  },
              { v: '7d'    as const, label: '7 Days' },
              { v: '30d'   as const, label: '30 Days'},
              { v: 'all'   as const, label: 'All'    },
            ]).map(({ v, label }) => (
              <Chip key={v} label={label} size="small" onClick={() => setTimeRange(v)}
                sx={{ fontSize: '0.78rem', fontWeight: 700, height: 24, cursor: 'pointer',
                  bgcolor: timeRange === v ? '#6366f1' : 'white',
                  color:   timeRange === v ? 'white'   : '#64748b',
                  border: `1px solid ${timeRange === v ? '#6366f1' : '#e2e8f0'}`,
                }} />
            ))}
          </Box>
        )}

        {/* Risk level pills */}
        <Box sx={{ display: 'flex', gap: 0.4, ml: 'auto' }}>
          {([
            { r: '',       label: 'All',  bg: '#334155' },
            { r: 'High',   label: '🔴 H', bg: '#ef4444' },
            { r: 'Medium', label: '🟠 M', bg: '#f97316' },
            { r: 'Low',    label: '🟢 L', bg: '#22c55e' },
          ]).map(({ r, label, bg }) => (
            <Chip key={r || 'all'} label={label} size="small" onClick={() => setFilterRisk(r)}
              sx={{ fontSize: '0.78rem', fontWeight: 700, height: 24, cursor: 'pointer',
                bgcolor: filterRisk === r ? bg    : 'white',
                color:   filterRisk === r ? 'white' : '#64748b',
                border: `1px solid ${filterRisk === r ? 'transparent' : '#e2e8f0'}`,
              }} />
          ))}
        </Box>

        {/* Dropdowns */}
        {caseTypes.length > 1 && (
          <Select size="small" value={filterType} onChange={e => setFilterType(e.target.value as string)} displayEmpty
            sx={{ fontSize: '0.78rem', height: 28, borderRadius: 1.5, minWidth: 110, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e2e8f0' }, '& .MuiSelect-select': { py: '4px' } }}>
            <MenuItem value="" sx={{ fontSize: '0.82rem' }}>All Types</MenuItem>
            {caseTypes.map(t => <MenuItem key={t} value={t} sx={{ fontSize: '0.82rem' }}>{t}</MenuItem>)}
          </Select>
        )}
        {statuses.length > 1 && (
          <Select size="small" value={filterStatus} onChange={e => setFilterStatus(e.target.value as string)} displayEmpty
            sx={{ fontSize: '0.78rem', height: 28, borderRadius: 1.5, minWidth: 110, '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e2e8f0' }, '& .MuiSelect-select': { py: '4px' } }}>
            <MenuItem value="" sx={{ fontSize: '0.82rem' }}>All Status</MenuItem>
            {statuses.map(s => <MenuItem key={s} value={s} sx={{ fontSize: '0.82rem' }}>{s}</MenuItem>)}
          </Select>
        )}

        {hasFilters && (
          <Chip label="✕ Clear" size="small" onClick={clearFilters}
            sx={{ fontSize: '0.72rem', fontWeight: 700, bgcolor: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', height: 24, cursor: 'pointer' }} />
        )}

        {/* Fullscreen toggle */}
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <IconButton size="small" onClick={() => setIsFullscreen(f => !f)} sx={{ width: 28, height: 28, bgcolor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', '&:hover': { bgcolor: '#f1f5f9' } }}>
            {isFullscreen
              ? <FullscreenExit sx={{ fontSize: 14, color: '#64748b' }} />
              : <Fullscreen     sx={{ fontSize: 14, color: '#64748b' }} />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Map view ── */}
      {view === 'map' && (
        <Box sx={{ position: 'relative', height: mapHeight }}>

          {/* Stats overlay — top-left */}
          <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 0.75, pointerEvents: 'none' }}>
            <Paper elevation={6} sx={{ px: 1.75, py: 1.25, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)', minWidth: 158 }}>
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.6 }}>
                📍 Biñan 2nd · Bocaue, Bulacan
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.75 }}>
                <Typography sx={{ fontSize: '1.7rem', fontWeight: 900, color: '#0c1e46', lineHeight: 1 }}>{filtered.length}</Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>incident{filtered.length !== 1 ? 's' : ''}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center' }}>
                {[
                  { n: counts.high,   label: 'HIGH', color: '#ef4444' },
                  null,
                  { n: counts.medium, label: 'MED',  color: '#f97316' },
                  null,
                  { n: counts.low,    label: 'LOW',  color: '#22c55e' },
                ].map((item, i) =>
                  item === null
                    ? <Box key={i} sx={{ width: 1, height: 26, bgcolor: '#f1f5f9' }} />
                    : (
                      <Box key={item.label} sx={{ textAlign: 'center' }}>
                        <Typography sx={{ fontSize: '1rem', fontWeight: 900, color: item.color, lineHeight: 1 }}>{item.n}</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{item.label}</Typography>
                      </Box>
                    )
                )}
              </Box>
            </Paper>

            {highRiskAreas.length > 0 && (
              <Paper elevation={6} sx={{ px: 1.5, py: 1, borderRadius: 2.5, bgcolor: 'rgba(254,242,242,0.97)', backdropFilter: 'blur(16px)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.5 }}>
                  <Warning sx={{ fontSize: 12, color: '#dc2626' }} />
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#dc2626' }}>
                    {highRiskAreas.length} High-Risk Zone{highRiskAreas.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                {highRiskAreas.slice(0, 3).map(a => (
                  <Box key={a.barangay} sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.35 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.72rem', color: '#dc2626' }}>{a.barangay} · {a.avgScore}/100</Typography>
                  </Box>
                ))}
              </Paper>
            )}
          </Box>

          {/* Fit-to-markers button — top-right */}
          {filtered.length > 0 && (
            <Tooltip title="Fit map to visible incidents" placement="left">
              <Paper elevation={5} onClick={() => setFitTrigger(t => t + 1)}
                sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: '8px', bgcolor: 'white', transition: 'all .15s', '&:hover': { bgcolor: '#f1f5f9', transform: 'scale(1.1)' } }}>
                <CenterFocusStrong sx={{ fontSize: 14, color: '#374151' }} />
              </Paper>
            </Tooltip>
          )}

          {/* Map */}
          <MapContainer
            center={CENTER}
            zoom={DEFAULT_ZOOM}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            maxBounds={MAX_BOUNDS}
            maxBoundsViscosity={0.85}
            zoomControl={false}
            attributionControl={false}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            {/* Standard OpenStreetMap tiles — no API key, high availability */}
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              subdomains="abc"
              maxZoom={MAX_ZOOM}
              crossOrigin="anonymous"
            />
            <AttributionControl position="bottomright" prefix={false} />
            <ScaleControl position="bottomleft" imperial={false} />

            {/* Critical: fix broken tile grid on first render */}
            <MapInvalidateSize />
            <CaptureMap mapRef={mapRef} />
            <FitAll positions={positions} trigger={fitTrigger} />

            <ZoomBtns />
            <ReCenter onClick={reCentre} />

            {/* ── Incident Markers ── */}
            {layer === 'markers' && (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <MarkerClusterGroup iconCreateFunction={clusterIcon as any} maxClusterRadius={45} spiderfyOnMaxZoom showCoverageOnHover={false} chunkedLoading>
                {filtered.map(c => (
                  <Marker key={c.id} position={[c.lat, c.lng]} icon={dotIcon(c.level, c.level === 'High', c.isSample)}>
                    <Popup minWidth={240} maxWidth={295} closeButton>
                      <CasePopup c={c} onNavigate={navigate} />
                    </Popup>
                  </Marker>
                ))}
              </MarkerClusterGroup>
            )}

            {/* ── Heat Map (5-ring radial glow per case) ── */}
            {layer === 'heatmap' && filtered.map(c => {
              const color = RISK[c.level]?.color ?? '#94a3b8';
              const i = c.score / 100;
              return [
                <Circle key={`${c.id}-e`} center={[c.lat, c.lng]} radius={200}  pathOptions={{ fillColor: color, fillOpacity: i * 0.03, stroke: false }} />,
                <Circle key={`${c.id}-a`} center={[c.lat, c.lng]} radius={120}  pathOptions={{ fillColor: color, fillOpacity: i * 0.07, stroke: false }} />,
                <Circle key={`${c.id}-b`} center={[c.lat, c.lng]} radius={70}   pathOptions={{ fillColor: color, fillOpacity: i * 0.16, stroke: false }} />,
                <Circle key={`${c.id}-c`} center={[c.lat, c.lng]} radius={35}   pathOptions={{ fillColor: color, fillOpacity: i * 0.32, stroke: false }} />,
                <Circle key={`${c.id}-d`} center={[c.lat, c.lng]} radius={12}   pathOptions={{ fillColor: color, fillOpacity: i * 0.60, stroke: false }}>
                  <Popup minWidth={200}>
                    <div style={{ fontFamily: 'system-ui', padding: 2 }}>
                      <div style={{ fontWeight: 700, color: '#0c1e46', marginBottom: 3, fontSize: 13 }}>#{c.caseNumber} — {c.caseType}</div>
                      <div style={{ color: color, fontWeight: 700, fontSize: 12 }}>{c.level} · {c.score}/100</div>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{c.barangay}</div>
                    </div>
                  </Popup>
                </Circle>,
              ];
            })}

            {/* ── Risk Zones (shaded area circles) ── */}
            {layer === 'zones' && displayAreas.map(area => {
              const pos    = resolveArea(area.barangay);
              const isHigh = area.avgScore >= 65;
              const isMed  = area.avgScore >= 40;
              const color  = isHigh ? '#ef4444' : isMed ? '#f97316' : '#22c55e';
              const radius = 100 + area.total * 32;
              return [
                <Circle key={`${area.barangay}-fill`} center={pos} radius={radius}
                  pathOptions={{ fillColor: color, fillOpacity: isHigh ? 0.18 : 0.11, color, weight: isHigh ? 2.5 : 1.5, opacity: 0.65, dashArray: isHigh ? undefined : '8 5' }} />,
                <Circle key={`${area.barangay}-ring`} center={pos} radius={radius + 18}
                  pathOptions={{ fillOpacity: 0, color, weight: 1, opacity: 0.25, dashArray: '4 6' }}>
                  <Popup minWidth={215}>
                    <AreaPopup area={area} />
                  </Popup>
                </Circle>,
              ];
            })}
          </MapContainer>
        </Box>
      )}

      {/* ── Table view ── */}
      {view === 'table' && (
        <Box sx={{ overflow: 'auto', maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Case ID', 'Incident Type', 'Risk', 'AI Score', 'Location', 'Status', 'Date Filed', ''].map(h => (
                  <TableCell key={h} sx={{ bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.25, whiteSpace: 'nowrap' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: '#94a3b8', fontSize: '0.9rem' }}>
                    No incidents match the selected filters
                  </TableCell>
                </TableRow>
              ) : filtered.map(c => {
                const col = RISK[c.level]?.color ?? '#94a3b8';
                return (
                  <TableRow key={c.id} sx={{ '&:hover': { bgcolor: '#f8fafc' }, '& td': { py: 1, borderBottom: '1px solid #f8fafc' } }}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {c.level === 'High' && <Warning sx={{ fontSize: 13, color: '#ef4444' }} />}
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography>
                        {c.isSample && <Chip label="demo" size="small" sx={{ fontSize: '0.72rem', height: 22, bgcolor: '#f1f5f9', color: '#94a3b8' }} />}
                      </Box>
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem' }}>{c.caseType}</Typography></TableCell>
                    <TableCell>
                      <Chip label={c.level} size="small" sx={{ bgcolor: `${col}16`, color: col, fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 95 }}>
                        <LinearProgress variant="determinate" value={c.score}
                          sx={{ flex: 1, height: 5, borderRadius: 4, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: col, borderRadius: 4 } }} />
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: col, minWidth: 24 }}>{c.score}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.barangay}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#475569' }}>{c.status}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(c.filedAt)}</Typography></TableCell>
                    <TableCell>
                      {!c.isSample ? (
                        <Tooltip title="Open case detail">
                          <IconButton size="small" onClick={() => navigate(c.id)}>
                            <OpenInNew sx={{ fontSize: 14, color: '#94a3b8' }} />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Typography sx={{ fontSize: '0.72rem', color: '#cbd5e1' }}>demo</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {filtered.length > 0 && (
            <Box sx={{ px: 2, py: 1.25, bgcolor: '#f8fafc', borderTop: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                <strong>{filtered.length}</strong> incident{filtered.length !== 1 ? 's' : ''} · Biñan 2nd, Bocaue, Bulacan
              </Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 700 }}>{counts.high} High</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#f97316', fontWeight: 700 }}>{counts.medium} Medium</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#22c55e', fontWeight: 700 }}>{counts.low} Low</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* ── Hotspot ranking strip ── */}
      {displayAreas.length > 0 && (
        <Box sx={{ px: 2.5, py: 1.5, bgcolor: '#fafafa', borderTop: '1px solid #e2e8f0' }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            🔥 Street Hotspot Ranking — Biñan 2nd, Bocaue, Bulacan
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {[...displayAreas].sort((a, b) => b.avgScore - a.avgScore).slice(0, 6).map((area, i) => {
              const isHigh = area.avgScore >= 65;
              const isMed  = area.avgScore >= 40;
              const col    = isHigh ? '#ef4444' : isMed ? '#f97316' : '#22c55e';
              return (
                <Box key={area.barangay} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'white', border: `1px solid ${col}22`, flex: '1 0 130px', maxWidth: 200 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: `${col}14`, border: `2px solid ${col}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 900, color: col }}>#{i + 1}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#0c1e46', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {area.barangay}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.3 }}>
                      <LinearProgress variant="determinate" value={area.avgScore}
                        sx={{ flex: 1, height: 4, borderRadius: 4, bgcolor: `${col}16`, '& .MuiLinearProgress-bar': { bgcolor: col, borderRadius: 4 } }} />
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: col, minWidth: 20 }}>{area.avgScore}</Typography>
                    </Box>
                  </Box>
                  {isHigh && <Warning sx={{ fontSize: 12, color: '#ef4444', flexShrink: 0 }} />}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ── Legend ── */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 2, py: 1.25, bgcolor: '#f8fafc', borderTop: '1px solid #e2e8f0', alignItems: 'center' }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Legend</Typography>
        {[
          { col: '#ef4444', label: 'High ≥ 65',   pulse: true  },
          { col: '#f97316', label: 'Medium 40–64', pulse: false },
          { col: '#22c55e', label: 'Low < 40',     pulse: false },
        ].map(({ col, label, pulse }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{
              width: 10, height: 10, borderRadius: '50%', bgcolor: col,
              ...(pulse ? { animation: 'lm-pulse 1.9s ease-out infinite' } : {}),
            }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{label}</Typography>
          </Box>
        ))}
        {view === 'map' && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
            <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              {layer === 'markers'
                ? 'Click marker for details · Numbered clusters auto-expand · High-risk markers pulse'
                : layer === 'heatmap'
                ? 'Glow intensity ∝ AI risk score · 5-ring gradient per incident'
                : 'Solid = High-Risk Zone · Dashed = Medium/Low · Radius ∝ case count'}
            </Typography>
          </>
        )}
        <Typography sx={{ fontSize: '0.72rem', color: '#cbd5e1', ml: 'auto' }}>
          © OSM · CARTO · SafComm GeoRisk Engine
        </Typography>
      </Box>
    </Box>
  );
}
