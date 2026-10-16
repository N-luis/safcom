'use client';

import { useState, useMemo } from 'react';
import { Box, Typography, Chip, Tooltip } from '@mui/material';
import useSWR from 'swr';
import {
  STREET_NODES, STREET_AREAS, worstLevel,
  type StreetRiskResponse,
} from '@/lib/streetRisk';
import type { BarangayStreet } from '@/lib/streets';
import { BarangayBaseUnder, BarangayBaseOver, FONT } from '@/components/maps/BarangayBaseArt';

/**
 * Street risk heatmap for Brgy. Biñang 2nd, Bocaue.
 *
 * Geometry is traced from the barangay's own wall map ("Brgy. Biñang 2nd
 * Hazard Map"): the same roads, junctions, landmarks and subdivisions, in the
 * same relative positions. The hazard colour-coding of that map is
 * deliberately NOT carried over — every node ships as `None` with 0 incidents
 * so this reads as "no data yet". Colour and counts come from real blotter
 * entries; wire them in by overriding `level` / `incidents` per node id.
 */

type RiskLevel = 'High' | 'Medium' | 'Low' | 'None';

const LEVEL_COLOR: Record<RiskLevel, string> = {
  High: '#ef4444',
  Medium: '#f97316',
  Low: '#22c55e',
  None: '#94a3b8',
};

const LEVEL_LABEL: Record<RiskLevel, string> = {
  High: 'High Risk', Medium: 'Medium Risk', Low: 'Low Risk', None: 'No data',
};

const HEAT_R: Record<RiskLevel, number> = { High: 46, Medium: 34, Low: 22, None: 0 };
const NODE_R: Record<RiskLevel, number> = { High: 11, Medium: 9, Low: 7, None: 8 };
const HEAT_OP: Record<RiskLevel, number> = { High: 0.20, Medium: 0.14, Low: 0.09, None: 0 };

// --- Map coordinate space: 760 x 400 -----------------------------------------
// Landscape so the whole barangay fits on screen without scrolling.
// McArthur Hi-Way  y=130, west end x=20 -> Fly-Over junction x=305
// Cross streets    Ortega Comp./Sapa x=44 . Eugenio Comp. x=132
//                  J.P. Rizal St. diagonal (178,132)->(305,48)
//                  Violeta Metroville Subd. x=262 . Gov. F. Halili Ext. x=305
// North loop       (304,48) east, curving back down to the Fly-Over at (348,133)
// Gov. F. Halili Ave. runs south-east (342,130)->(452,320) to the PNR crossing
// PNR railway      diagonal (120,398)->(752,250); Turo and Granville below it

interface Zone {
  id: string; name: string; short: string;
  x: number; y: number;
  level: RiskLevel; incidents: number; desc: string;
  illZoneId: string;
  major: boolean;      // major nodes keep a permanent label
  labelDx?: number;    // nudge the label clear of neighbours / landmarks
  labelDy?: number;
}

/** The 10 monitored intersections. All neutral until real data is entered. */
const ZONES: Zone[] = [
  { id: 'ortega-mac', name: 'Ortega Comp. × McArthur Hi-Way', short: 'Ortega Comp.', x: 44, y: 130, level: 'None', incidents: 0, illZoneId: 'mcarthur', major: true, labelDx: -6, labelDy: 30,
    desc: 'West end of McArthur Hi-Way — Ortega Compound, continues south as Sapa' },
  { id: 'eugenio-mac', name: 'Eugenio Comp. × McArthur Hi-Way', short: 'Eugenio Comp.', x: 132, y: 130, level: 'None', incidents: 0, illZoneId: 'mcarthur', major: true, labelDx: -14, labelDy: -30,
    desc: 'Eugenio Compound running south off McArthur, past Sto. Niño Academy' },
  { id: 'rizal-mac', name: 'J.P. Rizal St. × McArthur Hi-Way', short: 'J.P. Rizal St.', x: 178, y: 130, level: 'None', incidents: 0, illZoneId: 'civic', major: true, labelDy: -30,
    desc: 'J.P. Rizal St. climbs north-east to the Fly-Over, enclosing the Brgy Hall block' },
  { id: 'violeta-mac', name: 'Violeta Metroville Subd. × McArthur Hi-Way', short: 'Violeta St.', x: 262, y: 130, level: 'None', incidents: 0, illZoneId: 'mcarthur', major: true, labelDx: 12, labelDy: -30,
    desc: 'Entry to Violeta St. / Metroville Subd. from McArthur Hi-Way' },
  { id: 'flyover', name: 'Fly-Over × Gov. F. Halili Ext.', short: 'Fly-Over', x: 305, y: 130, level: 'None', incidents: 0, illZoneId: 'civic', major: true, labelDx: 34, labelDy: -26,
    desc: 'Central junction — Gov. F. Halili Ext. north, Gov. F. Halili Ave. south' },
  { id: 'lazaro', name: 'P. Lazaro St. × north loop', short: 'P. Lazaro St.', x: 500, y: 64, level: 'None', incidents: 0, illZoneId: 'north-res', major: true, labelDy: -28,
    desc: 'North-east branch toward the P. Lazaro house cluster and Dr. Yanga Colleges' },
  { id: 'violeta-fork', name: 'Violeta St. fork', short: 'Violeta Fork', x: 262, y: 208, level: 'None', incidents: 0, illZoneId: 'metroville', major: true, labelDx: -4,
    desc: 'Fork into the Metroville Subd. grid — three parallel residential rows south' },
  { id: 'halili-mid', name: 'Gov. F. Halili Ave. midpoint', short: 'Gov. F. Halili Ave.', x: 402, y: 224, level: 'None', incidents: 0, illZoneId: 'halili', major: true,
    desc: 'Mid-stretch of Gov. F. Halili Ave. between the Fly-Over and the railway' },
  { id: 'halili-pnr', name: 'Gov. F. Halili Ave. × PNR crossing', short: 'PNR Crossing', x: 452, y: 316, level: 'None', incidents: 0, illZoneId: 'halili', major: true,
    desc: 'PNR railway crossing — Gov. F. Halili Ave. continues south as Turo' },
  { id: 'ayukit-pnr', name: 'Ayukit × PNR crossing', short: 'Ayukit', x: 596, y: 283, level: 'None', incidents: 0, illZoneId: 'granville', major: true, labelDx: 34,
    desc: 'Ayukit meeting the railway, connecting Granville Subd. through to Turo' },
  // These three are on the report form's street list but had no point on the
  // map, so an incident there could never show. Minor: they stay unlabelled
  // while quiet and name themselves once they carry incidents.
  { id: 'benedicto', name: 'J. Benedicto St. × Gov. F. Halili Ext.', short: 'J. Benedicto St.', x: 307, y: 69, level: 'None', incidents: 0, illZoneId: 'north-res', major: false, labelDx: -22, labelDy: -12,
    desc: 'J. Benedicto St. — northern row of the residential grid inside the loop' },
  { id: 'mendoza', name: 'A. Mendoza St. × Gov. F. Halili Ext.', short: 'A. Mendoza St.', x: 307, y: 91, level: 'None', incidents: 0, illZoneId: 'north-res', major: false, labelDx: -22, labelDy: 6,
    desc: 'A. Mendoza St. — southern row of the residential grid inside the loop' },
  { id: 'granville-mid', name: 'Granville Subd. interior', short: 'Granville Subd.', x: 650, y: 204, level: 'None', incidents: 0, illZoneId: 'granville', major: false, labelDy: 4,
    desc: 'Granville Subd. residential block, east of Ayukit and north of the railway' },
];

/** Road network between monitored points. */
const STREETS: [string, string][] = [
  ['ortega-mac', 'eugenio-mac'], ['eugenio-mac', 'rizal-mac'],
  ['rizal-mac', 'violeta-mac'], ['violeta-mac', 'flyover'],
  ['flyover', 'lazaro'],
  ['violeta-mac', 'violeta-fork'],
  ['flyover', 'halili-mid'], ['halili-mid', 'halili-pnr'],
  ['halili-pnr', 'ayukit-pnr'],
];

interface IllZone {
  id: string; label: string; level: RiskLevel; incidents: number;
  x: number; y: number; w: number; h: number; detail: string;
}

/** District shading. Neutral until real incident data arrives. */
const ILL_ZONES: IllZone[] = [
  { id: 'north-res', label: 'North Residential Cluster', level: 'None', incidents: 0, x: 300, y: 38, w: 392, h: 98,
    detail: 'J. Benedicto St. / A. Mendoza St. grid plus the P. Lazaro St. house cluster' },
  { id: 'mcarthur', label: 'McArthur Hi-Way Corridor', level: 'None', incidents: 0, x: 36, y: 120, w: 222, h: 22,
    detail: 'Main through-road — Ortega Comp., Eugenio Comp. and Violeta St. crossings' },
  { id: 'civic', label: 'Civic Center (Brgy Hall)', level: 'None', incidents: 0, x: 180, y: 50, w: 120, h: 78,
    detail: 'Brgy Hall and Senior Citizen Office inside the J.P. Rizal St. / Fly-Over block' },
  { id: 'metroville', label: 'Violeta St. / Metroville Subd.', level: 'None', incidents: 0, x: 142, y: 190, w: 190, h: 100,
    detail: 'Residential grid south of McArthur — three parallel rows off the Violeta St. fork' },
  { id: 'halili', label: 'Gov. F. Halili Ave. Corridor', level: 'None', incidents: 0, x: 336, y: 142, w: 100, h: 180,
    detail: 'Gov. F. Halili Ave. from the Fly-Over down to the PNR crossing, then Turo' },
  { id: 'granville', label: 'Granville Subd.', level: 'None', incidents: 0, x: 508, y: 152, w: 240, h: 238,
    detail: 'Residential block east of Ayukit, above the PNR railway crossing' },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface RiskHeatMapProps {
  title?: string;
  contextLabel?: string;
  accent?: string;
  /** Which cases colour the map - the module showing it. */
  scope?: 'all' | 'blotter' | 'vawc';
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(d => d?.data ?? null);

/**
 * Folds the per-street totals onto the map. A street can cover more than one
 * node (a stretch between two junctions), in which case both carry that
 * street's count - the node number is "incidents on this street", not a
 * separate tally per junction.
 */
function applyStreetRisk(data: StreetRiskResponse | null) {
  const nodes = new Map<string, { level: RiskLevel; incidents: number; streets: string[] }>();
  const areas = new Map<string, { level: RiskLevel; incidents: number; streets: string[] }>();

  const add = (
    map: Map<string, { level: RiskLevel; incidents: number; streets: string[] }>,
    id: string, level: RiskLevel, n: number, street: string,
  ) => {
    const cur = map.get(id) ?? { level: 'None' as RiskLevel, incidents: 0, streets: [] };
    map.set(id, {
      level: worstLevel(cur.level, level),
      incidents: cur.incidents + n,
      streets: [...cur.streets, street],
    });
  };

  for (const row of data?.streets ?? []) {
    const key = row.street as BarangayStreet;
    (STREET_NODES[key] ?? []).forEach(id => add(nodes, id, row.level as RiskLevel, row.total, row.street));
    (STREET_AREAS[key] ?? []).forEach(id => add(areas, id, row.level as RiskLevel, row.total, row.street));
  }

  const zones: Zone[] = ZONES.map(z => {
    const hit = nodes.get(z.id);
    if (!hit) return z;
    return {
      ...z, level: hit.level, incidents: hit.incidents,
      desc: `${hit.incidents} incident${hit.incidents === 1 ? '' : 's'} reported on ${hit.streets.join(' / ')}. ${z.desc}`,
    };
  });

  const illZones: IllZone[] = ILL_ZONES.map(a => {
    const hit = areas.get(a.id);
    if (!hit) return a;
    return { ...a, level: hit.level, incidents: hit.incidents };
  });

  return { zones, illZones };
}

export default function RiskHeatMap({
  title        = 'Biñang 2nd, Bocaue — Street Risk Heatmap',
  contextLabel = 'Geographic view',
  accent       = '#1d4ed8',
  scope        = 'all',
}: RiskHeatMapProps = {}) {
  const [filter, setFilter]           = useState<RiskLevel | 'All'>('All');
  const [hovered, setHovered]         = useState<Zone | null>(null);
  const [hoveredArea, setHoveredArea] = useState<IllZone | null>(null);
  const [selected, setSelected]       = useState<string | null>(null);

  // Re-reads while the officer is looking, so a case filed at the desk shows up
  // on the map without anyone reloading the page.
  const { data: risk, isLoading } = useSWR<StreetRiskResponse | null>(
    `/api/risk/streets?scope=${scope}`, fetcher, { refreshInterval: 30000, revalidateOnFocus: true },
  );

  const { zones: LIVE_ZONES, illZones: LIVE_AREAS } =
    useMemo(() => applyStreetRisk(risk ?? null), [risk]);

  const zoneMap = Object.fromEntries(LIVE_ZONES.map(z => [z.id, z]));
  const visible = (z: Zone) => filter === 'All' || z.level === filter;

  const counts: Record<RiskLevel, number> = {
    High:   LIVE_ZONES.filter(z => z.level === 'High').length,
    Medium: LIVE_ZONES.filter(z => z.level === 'Medium').length,
    Low:    LIVE_ZONES.filter(z => z.level === 'Low').length,
    None:   LIVE_ZONES.filter(z => z.level === 'None').length,
  };

  const selectedNode = selected ? zoneMap[selected] ?? null : null;
  const pinnedArea   = selectedNode
    ? LIVE_AREAS.find(a => a.id === selectedNode.illZoneId) ?? null
    : null;

  const panel =
    hovered
      ? { color: LEVEL_COLOR[hovered.level], title: hovered.name, level: hovered.level,
          incidents: hovered.incidents, desc: hovered.desc, tag: 'Street node' }
      : hoveredArea
        ? { color: LEVEL_COLOR[hoveredArea.level], title: hoveredArea.label, level: hoveredArea.level,
            incidents: hoveredArea.incidents, desc: hoveredArea.detail, tag: 'Area' }
        : selectedNode
          ? { color: LEVEL_COLOR[selectedNode.level], title: selectedNode.name, level: selectedNode.level,
              incidents: selectedNode.incidents, desc: selectedNode.desc, tag: 'Pinned' }
          : null;

  const filters: { label: RiskLevel | 'All'; color: string }[] = [
    { label: 'All',    color: '#0c1e46' },
    { label: 'High',   color: '#ef4444' },
    { label: 'Medium', color: '#f97316' },
    { label: 'Low',    color: '#22c55e' },
    { label: 'None',   color: '#94a3b8' },
  ];

  const totalIncidents = risk?.placed ?? 0;
  const unplaced = risk?.unplaced ?? 0;
  const awaitingData = !isLoading && totalIncidents === 0;


  return (
    <Box>
      {/* ── Filter chips ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {filters.map(f => {
            const active = filter === f.label;
            const count = f.label === 'All' ? LIVE_ZONES.length : counts[f.label as RiskLevel];
            return (
              <Chip
                key={f.label}
                label={`${f.label === 'None' ? 'No data' : f.label} (${count})`}
                onClick={() => setFilter(f.label)}
                size="small"
                sx={{
                  fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                  bgcolor: active ? `${f.color}18` : '#f8fafc',
                  color:   active ? f.color : '#64748b',
                  border:  `1.5px solid ${active ? f.color : '#e8edf2'}`,
                  '&:hover': { bgcolor: `${f.color}14` }, transition: 'all 0.15s',
                }}
              />
            );
          })}
        </Box>
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', ml: 'auto' }}>
          Hover a node or block · click a node to pin its zone
        </Typography>
      </Box>

      {/* ── Combined map ── */}
      <Box sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid #e8edf2', bgcolor: '#fff' }}>
        <Box sx={{
          px: 1.75, py: 1, borderBottom: '1px solid #eef2f6',
          display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
        }}>
          <Typography sx={{
            fontSize: '0.78rem', color: '#0c1e46', fontWeight: 800,
            letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
            {title}
          </Typography>
          <Chip label={contextLabel} size="small"
            sx={{ bgcolor: `${accent}14`, color: accent, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          {awaitingData && (
            <Chip label="Awaiting incident data" size="small"
              sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          )}
          {unplaced > 0 && (
            <Tooltip
              title={`Filed against a location that is not one of the barangay's streets, so they cannot be placed: ${(risk?.unplacedValues ?? []).join(', ')}`}
            >
              <Chip label={`${unplaced} not on a street`} size="small"
                sx={{ bgcolor: '#fff7ed', color: '#b45309', fontWeight: 700, fontSize: '0.72rem', height: 22, cursor: 'help' }} />
            </Tooltip>
          )}
          {pinnedArea && (
            <Chip label={`● ${pinnedArea.label}`} size="small"
              sx={{
                bgcolor: `${LEVEL_COLOR[pinnedArea.level]}18`, color: LEVEL_COLOR[pinnedArea.level],
                fontWeight: 700, fontSize: '0.72rem', height: 22,
                animation: 'fadeIn 0.3s ease',
                '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
              }} />
          )}
          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', ml: 'auto' }}>
            {totalIncidents} incidents · {LIVE_ZONES.length} monitored points
          </Typography>
        </Box>

        <Box sx={{ bgcolor: '#fdfbf7' }}>
          <svg viewBox="0 0 760 400" width="100%" preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', width: '100%', height: 'auto' }}
            aria-label="Biñang 2nd, Bocaue street-level risk map, traced from the barangay hazard map">
            <defs>
              <filter id="rh-h"><feGaussianBlur stdDeviation="15" /></filter>
              <filter id="rh-m"><feGaussianBlur stdDeviation="11" /></filter>
              <filter id="rh-l"><feGaussianBlur stdDeviation="7"  /></filter>
            </defs>

            <BarangayBaseUnder />

            {/* Risk heat, generated from the street nodes (none while neutral) */}
            {LIVE_ZONES.filter(z => z.level !== 'None').map(z => {
              const vis = visible(z);
              const op  = vis ? (filter === 'All' ? HEAT_OP[z.level] : HEAT_OP[z.level] * 1.6) : 0.015;
              const fid = z.level === 'High' ? 'rh-h' : z.level === 'Medium' ? 'rh-m' : 'rh-l';
              return (
                <circle key={`blob-${z.id}`} cx={z.x} cy={z.y} r={HEAT_R[z.level]}
                  fill={LEVEL_COLOR[z.level]} opacity={op} filter={`url(#${fid})`} />
              );
            })}

            <BarangayBaseOver />

            {/* ── Area hover targets (under the network so nodes win) ── */}
            {LIVE_AREAS.map(a => {
              const isHov = hoveredArea?.id === a.id;
              const isPin = pinnedArea?.id === a.id;
              return (
                <rect key={a.id} x={a.x} y={a.y} width={a.w} height={a.h}
                  fill="transparent"
                  stroke={(isHov || isPin) ? LEVEL_COLOR[a.level] : 'transparent'}
                  strokeWidth={isHov ? 2.5 : 0}
                  rx={3} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredArea(a)}
                  onMouseLeave={() => setHoveredArea(null)}
                />
              );
            })}

            {pinnedArea && (
              <rect x={pinnedArea.x} y={pinnedArea.y} width={pinnedArea.w} height={pinnedArea.h}
                fill={`${LEVEL_COLOR[pinnedArea.level]}14`}
                stroke={LEVEL_COLOR[pinnedArea.level]} strokeWidth={2.5} rx={3}
                style={{ pointerEvents: 'none' }}>
                <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
              </rect>
            )}

            {/* ── Links between monitored points ──
              * Deliberately NOT risk-coloured. These are straight chords between
              * node coordinates, not the real road geometry, which is drawn
              * accurately underneath - a thick red chord would both cut across
              * the map and imply risk on a street with no incidents, since an
              * edge touches two nodes and only one of them may be reporting.
              * Risk reads from the nodes and their halos instead. */}
            {STREETS.map(([a, b]) => {
              const zA = zoneMap[a]; const zB = zoneMap[b];
              if (!zA || !zB) return null;
              if (!visible(zA) && !visible(zB)) return null;
              const isSel = selected === zA.id || selected === zB.id;
              return (
                <line key={`edge-${a}-${b}`} x1={zA.x} y1={zA.y} x2={zB.x} y2={zB.y}
                  stroke={LEVEL_COLOR.None} strokeWidth={isSel ? 4.4 : 2.6}
                  strokeLinecap="round" opacity={isSel ? 0.7 : 0.45}
                  strokeDasharray="5,4"
                  style={{ pointerEvents: 'none' }} />
              );
            })}

            {/* ── High-risk pulse rings ── */}
            {LIVE_ZONES.filter(z => z.level === 'High' && visible(z)).map(z => (
              <circle key={`pulse-${z.id}`} cx={z.x} cy={z.y} r={NODE_R.High}
                fill="none" stroke={LEVEL_COLOR.High} strokeWidth={2} opacity={0}
                style={{ pointerEvents: 'none' }}>
                <animate attributeName="r" values={`${NODE_R.High};${NODE_R.High + 17};${NODE_R.High}`} dur="2.3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0;0.55" dur="2.3s" repeatCount="indefinite" />
              </circle>
            ))}

            {selectedNode && (
              <circle cx={selectedNode.x} cy={selectedNode.y} r={NODE_R[selectedNode.level] + 7}
                fill="none" stroke={LEVEL_COLOR[selectedNode.level]} strokeWidth={2.5}
                opacity={0.75} style={{ pointerEvents: 'none' }}>
                <animate attributeName="stroke-opacity" values="0.75;0.2;0.75" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}

            {/* ── Street nodes ── */}
            {LIVE_ZONES.map(z => {
              const vis   = visible(z);
              const isHov = hovered?.id === z.id;
              const isSel = selected === z.id;
              const r     = NODE_R[z.level] + (isHov || isSel ? 2 : 0);
              const showLabel = vis && (z.major || z.level !== 'None' || isHov || isSel);
              return (
                <g key={z.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(z)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(prev => prev === z.id ? null : z.id)}>
                  <circle cx={z.x} cy={z.y} r={NODE_R[z.level] + 9} fill="transparent" />
                  <circle cx={z.x} cy={z.y} r={r}
                    fill={vis ? (z.level === 'None' ? '#e2e8f0' : LEVEL_COLOR[z.level]) : '#cbd5e1'}
                    stroke={z.level === 'None' ? LEVEL_COLOR.None : 'white'}
                    strokeWidth={z.level === 'None' ? 2 : (isSel ? 3 : 2.2)}
                    opacity={vis ? 1 : 0.25} />
                  {vis && z.incidents >= 1 && NODE_R[z.level] >= 9 && (
                    <text x={z.x} y={z.y + 3.2} textAnchor="middle" fontSize={8} fill="white"
                      fontFamily={FONT} fontWeight="700" style={{ pointerEvents: 'none' }}>
                      {z.incidents}
                    </text>
                  )}
                  {showLabel && (
                    <text x={z.x + (z.labelDx ?? 0)} y={z.y + NODE_R[z.level] + 11 + (z.labelDy ?? 0)}
                      textAnchor="middle" fontSize={7} fontFamily={FONT}
                      fontWeight={isHov || isSel ? 700 : 600}
                      fill={isHov || isSel ? '#0c1e46' : '#334155'}
                      stroke="#fdfbf7" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round"
                      style={{ pointerEvents: 'none' }}>
                      {z.short}
                    </text>
                  )}
                </g>
              );
            })}

            {hovered && hovered.id !== selected && (
              <circle cx={hovered.x} cy={hovered.y} r={NODE_R[hovered.level] + 5}
                fill="none" stroke={LEVEL_COLOR[hovered.level]} strokeWidth={2} opacity={0.5}
                style={{ pointerEvents: 'none' }} />
            )}

            {/* ── North arrow ── */}
            <g transform="translate(735,22)" style={{ pointerEvents: 'none' }}>
              <circle r={13} fill="white" stroke="#e2e8f0" strokeWidth={0.8} />
              <text y={4} textAnchor="middle" fontSize={7.5} fill="#374151" fontFamily={FONT} fontWeight="700">N</text>
              <polygon points="0,-10 2.5,-2 0,-6 -2.5,-2" fill="#0c1e46" />
            </g>

            {/* ── Legend ── */}
            <g style={{ pointerEvents: 'none' }}>
              <rect x="16" y="296" width="104" height="60" rx={4} fill="rgba(255,255,255,0.94)" stroke="#e8edf2" strokeWidth={0.8} />
              {([
                ['High', '#ef4444'], ['Medium', '#f97316'], ['Low', '#22c55e'],
              ] as [string, string][]).map(([lab, col], i) => (
                <g key={lab}>
                  <circle cx={28} cy={310 + i * 13} r={4} fill={col} />
                  <text x={38} y={313 + i * 13} fontSize={6.6} fill="#374151" fontFamily={FONT} fontWeight="600">{lab}</text>
                </g>
              ))}
              <circle cx={28} cy={349} r={4} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1.5} />
              <text x={38} y={352} fontSize={6.6} fill="#374151" fontFamily={FONT} fontWeight="600">No data</text>
            </g>
          </svg>
        </Box>
      </Box>

      {/* ── Info panel ── */}
      <Box sx={{
        mt: 1.25, minHeight: 48, borderRadius: 2,
        border: `1px solid ${panel ? `${panel.color}40` : '#f1f5f9'}`,
        bgcolor: panel ? `${panel.color}06` : '#fafbfc',
        px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5, transition: 'all 0.15s',
      }}>
        {panel ? (
          <>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: panel.color, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.15, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>{panel.title}</Typography>
                <Chip label={LEVEL_LABEL[panel.level]} size="small"
                  sx={{ bgcolor: `${panel.color}18`, color: panel.color, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                {panel.incidents > 0 && (
                  <Chip label={`${panel.incidents} incident${panel.incidents !== 1 ? 's' : ''}`} size="small"
                    sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
                )}
                <Chip label={panel.tag} size="small"
                  sx={{ bgcolor: '#f8fafc', color: '#94a3b8', fontSize: '0.72rem', height: 22, fontWeight: 600 }} />
              </Box>
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{panel.desc}</Typography>
            </Box>
          </>
        ) : (
          <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic' }}>
            Hover a street node for incident detail, or a city block for area context · click a node to pin it
          </Typography>
        )}
      </Box>

      {/* ── Summary chips ── */}
      <Box sx={{ display: 'flex', gap: 0.75, mt: 1.5, flexWrap: 'wrap' }}>
        {(['High', 'Medium', 'Low', 'None'] as RiskLevel[]).map(lv => {
          const names = LIVE_ZONES.filter(z => z.level === lv).map(z => z.short);
          if (names.length === 0) return null;
          return (
            <Chip key={lv} label={`${LEVEL_LABEL[lv]}: ${names.join(' · ')}`} size="small"
              sx={{
                bgcolor: `${LEVEL_COLOR[lv]}12`, color: LEVEL_COLOR[lv],
                fontWeight: 600, fontSize: '0.72rem', height: 'auto', py: 0.3,
                '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.5 },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
