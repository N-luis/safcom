'use client';

import { useState } from 'react';
import { Box, Typography, Chip } from '@mui/material';

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

// --- Base map artwork --------------------------------------------------------
// House glyphs, matching the little home icons drawn on the wall map.
const HOUSES: [number, number][] = [
  // Sapa / Ortega Comp. southern end
  [78, 206], [86, 222], [94, 238],
  // North grid - A. Mendoza St. / J. Benedicto St.
  [316, 52], [332, 52], [348, 52], [364, 52], [380, 52],
  [316, 76], [332, 76], [348, 76], [364, 76], [380, 76],
  [316, 98], [332, 98], [348, 98], [364, 98], [380, 98],
  // P. Lazaro St. cluster
  [496, 76], [510, 76],
  [512, 90], [546, 90], [512, 106], [546, 106], [512, 122], [546, 122],
  // Along Gov. F. Halili Ave., near 7-Eleven
  [404, 182], [398, 198], [410, 212], [420, 190],
  // Metroville Subd. rows
  [168, 194], [196, 194], [224, 194], [284, 194], [308, 194],
  [168, 224], [196, 224], [224, 224], [284, 224], [308, 224],
  [168, 258], [196, 258], [224, 258], [284, 258], [308, 258],
  // Granville Subd. block
  [556, 170], [612, 170], [668, 170],
  [556, 196], [612, 196], [668, 196],
  [556, 222], [612, 222], [668, 222],
  [520, 178], [520, 204], [520, 230],
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

/** Little home glyph — square body with a pitched roof, as drawn on the source map. */
function House({ x, y }: { x: number; y: number }) {
  const w = 9, h = 9, roof = 3.4;
  return (
    <path
      d={`M ${x},${y + h} L ${x},${y + roof} L ${x + w / 2},${y} L ${x + w},${y + roof} L ${x + w},${y + h} Z`}
      fill="#e6e0d2" stroke="#9c937f" strokeWidth={0.8} strokeLinejoin="round"
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RiskHeatMapProps {
  title?: string;
  contextLabel?: string;
  accent?: string;
}

export default function RiskHeatMap({
  title        = 'Biñang 2nd, Bocaue — Street Risk Heatmap',
  contextLabel = 'Geographic view',
  accent       = '#1d4ed8',
}: RiskHeatMapProps = {}) {
  const [filter, setFilter]           = useState<RiskLevel | 'All'>('All');
  const [hovered, setHovered]         = useState<Zone | null>(null);
  const [hoveredArea, setHoveredArea] = useState<IllZone | null>(null);
  const [selected, setSelected]       = useState<string | null>(null);

  const zoneMap = Object.fromEntries(ZONES.map(z => [z.id, z]));
  const visible = (z: Zone) => filter === 'All' || z.level === filter;

  const counts: Record<RiskLevel, number> = {
    High:   ZONES.filter(z => z.level === 'High').length,
    Medium: ZONES.filter(z => z.level === 'Medium').length,
    Low:    ZONES.filter(z => z.level === 'Low').length,
    None:   ZONES.filter(z => z.level === 'None').length,
  };

  const selectedNode = selected ? zoneMap[selected] ?? null : null;
  const pinnedArea   = selectedNode
    ? ILL_ZONES.find(a => a.id === selectedNode.illZoneId) ?? null
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

  const totalIncidents = ZONES.reduce((s, z) => s + z.incidents, 0);
  const awaitingData = ZONES.every(z => z.level === 'None');

  const ROAD = '#cdc5b4';
  const LABEL = '#6b7280';
  const FONT = 'Inter,system-ui,sans-serif';

  return (
    <Box>
      {/* ── Filter chips ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {filters.map(f => {
            const active = filter === f.label;
            const count = f.label === 'All' ? ZONES.length : counts[f.label as RiskLevel];
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
            {totalIncidents} incidents · {ZONES.length} monitored points
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

            <rect width="760" height="400" fill="#fdfbf7" />

            {/* Neutral district fills - structure only, no severity meaning */}
            <rect x="300" y="38"  width="392" height="98"  rx={4} fill="#f5f2e9" />
            <polygon points="182,128 300,50 300,128" fill="#eff2f6" />
            <rect x="142" y="190" width="190" height="100" rx={4} fill="#f2f4ee" />
            <rect x="508" y="152" width="240" height="238" rx={4} fill="#f2f4ee" />

            {/* Bocaue River - north-south, above the north loop */}
            <path d="M 404,0 C 402,14 397,26 399,38 C 400,42 400,44 399,46"
              stroke="#bfdbfe" strokeWidth={10} fill="none" strokeLinecap="round" />
            <text x="416" y="22" fontSize={6.6} fill="#1d4ed8" fontFamily={FONT} fontWeight="700">BOCAUE RIVER</text>

            {/* Risk heat, generated from the street nodes (none while neutral) */}
            {ZONES.filter(z => z.level !== 'None').map(z => {
              const vis = visible(z);
              const op  = vis ? (filter === 'All' ? HEAT_OP[z.level] : HEAT_OP[z.level] * 1.6) : 0.015;
              const fid = z.level === 'High' ? 'rh-h' : z.level === 'Medium' ? 'rh-m' : 'rh-l';
              return (
                <circle key={`blob-${z.id}`} cx={z.x} cy={z.y} r={HEAT_R[z.level]}
                  fill={LEVEL_COLOR[z.level]} opacity={op} filter={`url(#${fid})`} />
              );
            })}

            {/* PNR railway (drawn first, roads cross over it) */}
            <line x1="140" y1="387" x2="752" y2="247" stroke="#8b8172" strokeWidth={1.1} />
            <line x1="141" y1="392" x2="753" y2="252" stroke="#8b8172" strokeWidth={1.1} />
            {Array.from({ length: 44 }).map((_, i) => {
              const t = i / 43;
              const x = 141 + t * 612, y = 390 - t * 140;
              return <line key={`rail-${i}`} x1={x - 2} y1={y + 4} x2={x + 2} y2={y - 5}
                stroke="#a89e8c" strokeWidth={1.2} />;
            })}

            {/* --- Roads --- */}
            {/* McArthur Hi-Way (major, dashed centre) */}
            <rect x="38" y="122" width="322" height="16" fill="#bdb5a4" />
            <rect x="38" y="121" width="322" height="2.5" fill="#cec6b5" />
            <rect x="38" y="136" width="322" height="2.5" fill="#cec6b5" />
            <line x1="42" y1="130" x2="304" y2="130" stroke="#f0c040" strokeWidth="1.4" strokeDasharray="14,9" />

            {/* Ortega Comp. -> Sapa */}
            <rect x="39" y="130" width="11" height="122" fill={ROAD} />
            {/* Eugenio Comp. */}
            <rect x="127" y="130" width="10" height="102" fill={ROAD} />
            {/* Violeta St. / Metroville Subd. */}
            <rect x="257" y="130" width="10" height="172" fill={ROAD} />
            {/* Gov. F. Halili Ext. */}
            <rect x="299" y="46" width="11" height="90" fill={ROAD} />
            {/* J.P. Rizal St. diagonal */}
            <line x1="178" y1="133" x2="305" y2="49" stroke={ROAD} strokeWidth={10} strokeLinecap="round" />

            {/* North loop - Gov. F. Halili Ext. curving back to the Fly-Over */}
            <path d="M 304,48 H 400 Q 428,48 428,74 V 100 Q 428,126 400,131 L 358,133"
              stroke={ROAD} strokeWidth={10} fill="none" strokeLinecap="round" />

            {/* J. Benedicto St. / A. Mendoza St. inside the loop */}
            <rect x="312" y="66" width="92" height="6" fill={ROAD} />
            <rect x="312" y="88" width="92" height="6" fill={ROAD} />

            {/* P. Lazaro St. - east off the loop, then south */}
            <path d="M 428,64 H 520 Q 534,64 534,78 V 128"
              stroke={ROAD} strokeWidth={9} fill="none" strokeLinecap="round" />

            {/* Gov. F. Halili Ave. - south-east to the railway, then Turo */}
            <line x1="352" y1="132" x2="452" y2="316" stroke={ROAD} strokeWidth={10} strokeLinecap="round" />
            <rect x="448" y="316" width="9" height="68" fill={ROAD} />

            {/* Metroville Subd. rows */}
            <rect x="150" y="208" width="170" height="6" fill={ROAD} />
            <rect x="150" y="238" width="170" height="6" fill={ROAD} />
            <rect x="150" y="274" width="170" height="6" fill={ROAD} />

            {/* Granville Subd. block + Ayukit */}
            <rect x="540" y="158" width="160" height="92" fill="none" stroke={ROAD} strokeWidth={7} />
            <line x1="650" y1="161" x2="650" y2="247" stroke={ROAD} strokeWidth={6} />
            {/* Ayukit - Granville's western divider, carried south to the railway */}
            <rect x="592" y="158" width="8" height="226" fill={ROAD} />

            {/* Roads below the railway */}
            <rect x="448" y="338" width="282" height="6" fill={ROAD} />
            <rect x="448" y="378" width="282" height="6" fill={ROAD} />

            {/* Fly-Over - McArthur carried over the Gov. F. Halili junction */}
            <rect x="308" y="121" width="50" height="18" rx={2} fill="#d5cdbc" />
            <line x1="308" y1="122.5" x2="358" y2="122.5" stroke="#a9a08c" strokeWidth={1.3} />
            <line x1="308" y1="137.5" x2="358" y2="137.5" stroke="#a9a08c" strokeWidth={1.3} />
            <line x1="320" y1="139" x2="320" y2="143" stroke="#b8af9b" strokeWidth={1.2} />
            <line x1="346" y1="139" x2="346" y2="143" stroke="#b8af9b" strokeWidth={1.2} />
            <text x="333" y="132.4" textAnchor="middle" fontSize={5} fill="#5b5344"
              fontFamily={FONT} fontWeight="700" letterSpacing="0.4">FLY-OVER</text>

            {/* --- Landmarks --- */}
            {/* Brgy Hall - rotated to sit along the J.P. Rizal St. diagonal */}
            <g transform="rotate(-34,224,110)">
              <rect x="208" y="102" width="32" height="17" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
              <text x="224" y="113" textAnchor="middle" fontSize={5} fill="#334155" fontFamily={FONT} fontWeight="700">BRGY HALL</text>
            </g>

            {/* Senior Citizen Office - beside it, inside the same block */}
            <g transform="rotate(-34,268,86)">
              <rect x="250" y="76" width="36" height="20" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
              <text x="268" y="84" textAnchor="middle" fontSize={4.4} fill="#334155" fontFamily={FONT} fontWeight="700">SENIOR CITIZEN</text>
              <text x="268" y="91" textAnchor="middle" fontSize={4.4} fill="#334155" fontFamily={FONT} fontWeight="700">OFFICE</text>
            </g>

            {/* Shell Gas Station */}
            <rect x="60" y="144" width="52" height="20" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
            <text x="86" y="153" textAnchor="middle" fontSize={5} fill="#334155" fontFamily={FONT} fontWeight="700">SHELL</text>
            <text x="86" y="161" textAnchor="middle" fontSize={5} fill="#334155" fontFamily={FONT} fontWeight="700">GAS STATION</text>

            {/* Sto. Nino Academy School */}
            <rect x="142" y="144" width="32" height="36" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
            <g transform="rotate(-90,158,162)">
              <text x="158" y="160" textAnchor="middle" fontSize={4.6} fill="#334155" fontFamily={FONT} fontWeight="700">STO. NI&#209;O</text>
              <text x="158" y="167" textAnchor="middle" fontSize={4.6} fill="#334155" fontFamily={FONT} fontWeight="700">ACADEMY</text>
            </g>

            {/* McDonald's Bocaue */}
            <rect x="218" y="144" width="26" height="34" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
            <g transform="rotate(-90,231,161)">
              <text x="231" y="159" textAnchor="middle" fontSize={4.6} fill="#334155" fontFamily={FONT} fontWeight="700">MCDONALD&apos;S</text>
              <text x="231" y="166" textAnchor="middle" fontSize={4.6} fill="#334155" fontFamily={FONT} fontWeight="700">BOCAUE</text>
            </g>

            {/* 7-Eleven */}
            <rect x="380" y="144" width="22" height="26" rx={1.5} fill="#f2f5f9" stroke="#475569" strokeWidth={1.1} />
            <text x="391" y="158" textAnchor="middle" fontSize={4.8} fill="#334155" fontFamily={FONT} fontWeight="700"
              transform="rotate(-90,391,158)">7-ELEVEN</text>

            {/* Dr. Yanga Colleges */}
            <text x="624" y="44" textAnchor="middle" fontSize={6.4} fill="#334155" fontFamily={FONT} fontWeight="700">DR. YANGA COLLEGES</text>

            {/* --- Houses --- */}
            {HOUSES.map(([x, y], i) => <House key={i} x={x} y={y} />)}

            {/* --- Street name labels --- */}
            <text x="60" y="110" textAnchor="middle" fontSize={7.2} fill="#374151" fontFamily={FONT} fontWeight="700">MC ARTHUR HI-WAY</text>
            <text x="44" y="192" textAnchor="middle" fontSize={5.6} fill={LABEL} fontFamily={FONT} transform="rotate(-90,44,192)">ORTEGA COMP.</text>
            <text x="32" y="232" textAnchor="middle" fontSize={5.6} fill={LABEL} fontFamily={FONT} transform="rotate(-90,32,232)">SAPA</text>
            <text x="143" y="208" textAnchor="middle" fontSize={5.6} fill={LABEL} fontFamily={FONT} transform="rotate(-90,143,208)">EUGENIO COMP.</text>
            <text x="250" y="182" textAnchor="middle" fontSize={5.2} fill={LABEL} fontFamily={FONT} transform="rotate(-90,250,182)">VIOLETA METROVILLE SUBD.</text>
            <text x="304" y="96" textAnchor="middle" fontSize={5} fill="#5b5344" fontFamily={FONT} fontWeight="600" transform="rotate(-90,304,96)">GOV. F. HALILI EXT.</text>
            <text x="358" y="70.6" textAnchor="middle" fontSize={4.4} fill="#4b5563" fontFamily={FONT} fontWeight="700">J. BENEDICTO ST.</text>
            <text x="358" y="92.6" textAnchor="middle" fontSize={4.4} fill="#4b5563" fontFamily={FONT} fontWeight="700">A. MENDOZA ST.</text>
            <text x="585" y="315" textAnchor="middle" fontSize={5.6} fill={LABEL} fontFamily={FONT} transform="rotate(-90,585,315)">AYUKIT</text>
            <text x="440" y="366" textAnchor="middle" fontSize={5.6} fill={LABEL} fontFamily={FONT} transform="rotate(-90,440,366)">TURO</text>
            <text x="668" y="362" textAnchor="middle" fontSize={5.8} fill={LABEL} fontFamily={FONT} fontWeight="600">GRANVILLE SUBD.</text>
            <text x="232" y="300" textAnchor="middle" fontSize={5.8} fill={LABEL} fontFamily={FONT} fontWeight="600">METROVILLE SUBD.</text>

            {/* ── Area hover targets (under the network so nodes win) ── */}
            {ILL_ZONES.map(a => {
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

            {/* ── Risk-coloured street segments ── */}
            {STREETS.map(([a, b]) => {
              const zA = zoneMap[a]; const zB = zoneMap[b];
              if (!zA || !zB) return null;
              if (!visible(zA) && !visible(zB)) return null;
              const lvl: RiskLevel = [zA.level, zB.level].includes('High') ? 'High'
                : [zA.level, zB.level].includes('Medium') ? 'Medium'
                : [zA.level, zB.level].includes('Low') ? 'Low' : 'None';
              const w = lvl === 'High' ? 4.5 : lvl === 'Medium' ? 3.4 : lvl === 'Low' ? 2.4 : 2.6;
              const isSel = selected === zA.id || selected === zB.id;
              return (
                <line key={`edge-${a}-${b}`} x1={zA.x} y1={zA.y} x2={zB.x} y2={zB.y}
                  stroke={LEVEL_COLOR[lvl]} strokeWidth={isSel ? w + 1.8 : w}
                  strokeLinecap="round" opacity={isSel ? 0.85 : lvl === 'None' ? 0.45 : 0.55}
                  strokeDasharray={lvl === 'None' ? '5,4' : undefined}
                  style={{ pointerEvents: 'none' }} />
              );
            })}

            {/* ── High-risk pulse rings ── */}
            {ZONES.filter(z => z.level === 'High' && visible(z)).map(z => (
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
            {ZONES.map(z => {
              const vis   = visible(z);
              const isHov = hovered?.id === z.id;
              const isSel = selected === z.id;
              const r     = NODE_R[z.level] + (isHov || isSel ? 2 : 0);
              const showLabel = vis && (z.major || isHov || isSel);
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
          const names = ZONES.filter(z => z.level === lv).map(z => z.short);
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
