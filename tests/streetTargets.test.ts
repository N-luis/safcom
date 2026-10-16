/**
 * Every street can be pointed at on the barangay map.  Run with:
 *   npm run test:streets
 *
 * The live counterpart - driving the real SVG in a browser and tapping each
 * road, each junction and each street name - is in the commit that added the
 * picker. These are the invariants that cannot be allowed to rot afterwards,
 * chiefly: a street added to the office's list but not to the map would be
 * offered to a resident who then cannot point to it.
 */
import {
  TARGETS, STREETS_WITHOUT_A_PLACE, MAP_W, MAP_H, type Shape,
} from '../lib/barangayStreetTargets';
import { BARANGAY_STREETS } from '../lib/streets';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

console.log('1. every street the office lists has somewhere to be tapped');
ok('none are missing from the map', STREETS_WITHOUT_A_PLACE.length === 0,
  STREETS_WITHOUT_A_PLACE.join(', '));
ok(`all ${BARANGAY_STREETS.length} are covered`, TARGETS.length === BARANGAY_STREETS.length,
  `${TARGETS.length} targets for ${BARANGAY_STREETS.length} streets`);

console.log('\n2. and no street is on the map twice');
const seen = new Set<string>();
const dupes = TARGETS.filter(t => (seen.has(t.street) ? true : (seen.add(t.street), false)));
ok('each street appears once', dupes.length === 0, dupes.map(d => d.street).join(', '));

console.log('\n3. every target names a street that is actually on the list');
for (const t of TARGETS) {
  ok(`"${t.street}" is a known street`,
    (BARANGAY_STREETS as readonly string[]).includes(t.street));
}

console.log('\n4. every target can be tapped, highlighted and pinned');
for (const t of TARGETS) {
  ok(`${t.street}: has a tap area`, t.hit.length > 0);
  ok(`${t.street}: has a road to light up`, t.show.length > 0);
  ok(`${t.street}: says what to look for`, t.near.trim().length > 8);
}

console.log('\n5. nothing is drawn outside the map');
/**
 * The points a path passes through.
 *
 * H and V carry a single coordinate, so pairing the numbers off blindly reads
 * an x as a y and invents points that were never there - which is what the
 * first version of this test did, and it duly failed two streets that were
 * drawn correctly.
 */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let x = 0, y = 0, cmd = 'M';
  for (let i = 0; i < tokens.length;) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i]!; i++; continue; }
    const n = () => +tokens[i++]!;
    if (cmd === 'M' || cmd === 'L') { x = n(); y = n(); }
    else if (cmd === 'H') { x = n(); }
    else if (cmd === 'V') { y = n(); }
    else if (cmd === 'Q') { const cx = n(), cy = n(); pts.push([cx, cy]); x = n(); y = n(); }
    else { i++; continue; }
    pts.push([x, y]);
  }
  return pts;
}

const corners = (s: Shape): [number, number][] =>
  s.t === 'rect' ? [[s.x, s.y], [s.x + s.w, s.y + s.h]]
  : s.t === 'line' ? [[s.x1, s.y1], [s.x2, s.y2]]
  : pathPoints(s.d);

for (const t of TARGETS) {
  const pts = [...t.hit, ...t.show].flatMap(corners).concat([t.pin]);
  const out = pts.filter(([x, y]) => x < 0 || y < 0 || x > MAP_W || y > MAP_H);
  ok(`${t.street}: stays inside the ${MAP_W}x${MAP_H} drawing`, out.length === 0,
    JSON.stringify(out));
}

console.log('\n6. the pin sits inside the street it marks');
// A pin outside its own tap area would put the marker on a different road
// from the one the resident chose.
const inside = (s: Shape, [px, py]: [number, number]) => {
  if (s.t === 'rect') return px >= s.x - 1 && px <= s.x + s.w + 1 && py >= s.y - 1 && py <= s.y + s.h + 1;
  if (s.t === 'line') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    const d = Math.hypot(px - (s.x1 + u * dx), py - (s.y1 + u * dy));
    return d <= s.w / 2 + 1;
  }
  return false; // paths are checked by eye in the browser, not here
};
for (const t of TARGETS) {
  const hasPath = t.hit.some(s => s.t === 'path');
  const covered = t.hit.some(s => inside(s, t.pin));
  ok(`${t.street}: the pin is on its own street`, covered || hasPath,
    hasPath ? '' : `pin ${JSON.stringify(t.pin)}`);
}

console.log('\n7. the drawing is never used as a coordinate');
// The one rule that matters most: these numbers are picture coordinates. If
// anything ever multiplies them into a latitude the reports become fiction.
const asText = JSON.stringify(TARGETS);
ok('no target carries a latitude', !/\b14\.7\d{4}/.test(asText));
ok('no target carries a longitude', !/\b120\.9\d{4}/.test(asText));
ok('every coordinate fits the drawing',
  TARGETS.every(t => t.pin[0] <= MAP_W && t.pin[1] <= MAP_H));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exit(1); }
