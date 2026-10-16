/**
 * The barangay's own map, as artwork.
 *
 * Traced from the wall map in the hall ("Brgy. Biñang 2nd Hazard Map"): the
 * same roads, junctions, landmarks and subdivisions, in the same relative
 * positions. Nothing here carries risk - no colour, no counts, no severity.
 * It is the drawing only, so the officers' heatmap and the residents' street
 * picker cannot drift apart into two different-looking barangays.
 *
 * IMPORTANT - this is a diagram, not a projection. The roads are drawn where
 * they read clearly, not where they are on the ground. Fitting a transform
 * from these coordinates to latitude and longitude was tried and measured:
 * held-out control points landed a mean of 172m and as much as 384m from
 * their true position, across a barangay about a kilometre wide. So a point
 * on this drawing names a street; it must never be converted into a
 * coordinate. Real coordinates come from lib/streetPoints.ts, which holds
 * only points that were checked by reading them back from a geocoder.
 */

export { MAP_W, MAP_H } from '@/lib/barangayStreetTargets';

export const ROAD = '#cdc5b4';
export const LABEL = '#6b7280';
export const FONT = 'Inter,system-ui,sans-serif';

/** Little home glyph - square body with a pitched roof, as drawn on the source map. */
function House({ x, y }: { x: number; y: number }) {
  const w = 9, h = 9, roof = 3.4;
  return (
    <path
      d={`M ${x},${y + h} L ${x},${y + roof} L ${x + w / 2},${y} L ${x + w},${y + roof} L ${x + w},${y + h} Z`}
      fill="#e6e0d2" stroke="#9c937f" strokeWidth={0.8} strokeLinejoin="round"
    />
  );
}

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

/**
 * Ground, district fills and the river. Drawn first, so anything a caller
 * wants underneath the roads - the officers' heat blobs - goes between this
 * and BarangayBaseOver.
 */
export function BarangayBaseUnder() {
  return (
    <>
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

    </>
  );
}

/** Railway, roads, the fly-over, landmarks, houses and every street name. */
export function BarangayBaseOver() {
  return (
    <>
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
    </>
  );
}
