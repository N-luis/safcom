/**
 * Coordinate validation and address extraction for the incident location
 * picker.  Run with:  npm run test:geo
 */
import {
  isValidLatitude, isValidLongitude, isValidCoordinate, isWithinBarangay,
  roundCoord, toResolvedLocation, BARANGAY_CENTER,
  DEFAULT_MUNICIPALITY, DEFAULT_PROVINCE,
} from '../lib/geo';
import { pointForStreet, expandStreetName, STREET_POINTS } from '../lib/streetPoints';
import { nearestRoad, BARANGAY_ROADS } from '../lib/barangayRoads';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

console.log('1. a coordinate has to be a real one');
ok('0,0 is valid', isValidCoordinate(0, 0));
ok('the barangay centre is valid', isValidCoordinate(BARANGAY_CENTER.lat, BARANGAY_CENTER.lng));
ok('latitude 90 is the limit', isValidLatitude(90) && isValidLatitude(-90));
ok('latitude 90.1 is rejected', !isValidLatitude(90.1) && !isValidLatitude(-90.1));
ok('longitude 180 is the limit', isValidLongitude(180) && isValidLongitude(-180));
ok('longitude 180.1 is rejected', !isValidLongitude(180.1) && !isValidLongitude(-180.1));
([NaN, Infinity, -Infinity, null, undefined, '14.79', {}, []] as unknown[]).forEach(v =>
  ok(`${JSON.stringify(v) ?? String(v)} is not a latitude`, !isValidLatitude(v)));
ok('half a pin is not a pin', !isValidCoordinate(14.79, undefined) && !isValidCoordinate(undefined, 120.93));

console.log('\n2. the barangay box');
ok('the centre is inside', isWithinBarangay(BARANGAY_CENTER.lat, BARANGAY_CENTER.lng));
ok('a street nearby is inside', isWithinBarangay(BARANGAY_CENTER.lat + 0.01, BARANGAY_CENTER.lng - 0.01));
ok('Manila is outside', !isWithinBarangay(14.5995, 120.9842));
ok('the far side of the world is outside', !isWithinBarangay(-33.8688, 151.2093));

console.log('\n3. six decimals is enough for a street corner');
ok('rounds to six places', roundCoord(14.79473521234) === 14.794735, String(roundCoord(14.79473521234)));
ok('leaves a short value alone', roundCoord(14.79) === 14.79);

console.log('\n4. reading an address out of a provider reply');
// The exact shape Nominatim returned for a road in the barangay.
const reply = {
  lat: '14.7942329',
  lon: '120.9346650',
  display_name: 'Igulot-Biñang 1st Road, Biñang 2nd, Bocaue, Bulacan, Central Luzon, 3018, Philippines',
  address: {
    road: 'Igulot-Biñang 1st Road', quarter: 'Biñang 2nd',
    town: 'Bocaue', state: 'Bulacan', postcode: '3018', country: 'Philippines',
  },
};
const r = toResolvedLocation(reply, { lat: 0, lng: 0 });
ok('the road is the street', r.street === 'Igulot-Biñang 1st Road', String(r.street));
ok('the quarter is the barangay', r.barangay === 'Biñang 2nd', String(r.barangay));
ok('the town is the municipality', r.municipality === 'Bocaue', String(r.municipality));
ok('the state is the province', r.province === 'Bulacan', String(r.province));
ok('the coordinates come from the reply', r.latitude === 14.794233 && r.longitude === 120.934665,
  `${r.latitude},${r.longitude}`);
ok('the full line is kept', (r.label ?? '').startsWith('Igulot'), String(r.label));

console.log('\n5. a point with no road is reported as having none');
const bare = toResolvedLocation(
  { lat: '14.7947', lon: '120.9345', address: { town: 'Bocaue', state: 'Bulacan' } },
  { lat: 14.7947, lng: 120.9345 },
);
ok('street is null, not guessed', bare.street === null, String(bare.street));
ok('the point is still kept', bare.latitude === 14.7947 && bare.longitude === 120.9345);

console.log('\n6. a reply with nothing usable falls back to the pin');
const empty = toResolvedLocation({}, { lat: 14.1, lng: 120.2 });
ok('the clicked point survives', empty.latitude === 14.1 && empty.longitude === 120.2);
ok('the municipality defaults', empty.municipality === DEFAULT_MUNICIPALITY, String(empty.municipality));
ok('the province defaults', empty.province === DEFAULT_PROVINCE, String(empty.province));
ok('no street is invented', empty.street === null);

console.log('\n7. a reply with unusable coordinates falls back too');
const bad = toResolvedLocation({ lat: 'abc', lon: '999' }, { lat: 14.3, lng: 120.4 });
ok('garbage latitude is ignored', bad.latitude === 14.3, String(bad.latitude));
ok('out-of-range longitude is ignored', bad.longitude === 120.4, String(bad.longitude));

console.log('\n8. alternative field names are read');
const alt = toResolvedLocation(
  { lat: '14.79', lon: '120.93', address: { pedestrian: 'Violeta Walk', village: 'Biñang 2nd', city: 'Bocaue', province: 'Bulacan' } },
  { lat: 14.79, lng: 120.93 },
);
ok('a pedestrian way counts as a street', alt.street === 'Violeta Walk', String(alt.street));
ok('a village counts as a barangay', alt.barangay === 'Biñang 2nd', String(alt.barangay));
ok('a city counts as a municipality', alt.municipality === 'Bocaue', String(alt.municipality));


console.log('\n9. the barangay’s own street points');
ok('a verified street has a point', !!pointForStreet('J.P. Rizal St.'));
ok('its point is a real coordinate', (() => {
  const pt = pointForStreet('J.P. Rizal St.')!;
  return isValidCoordinate(pt.lat, pt.lng) && isWithinBarangay(pt.lat, pt.lng);
})());
ok('every written-down point is valid and nearby', Object.values(STREET_POINTS).every(
  pt => !!pt && isValidCoordinate(pt.lat, pt.lng) && isWithinBarangay(pt.lat, pt.lng)));
ok('every point records the address it was checked against',
  Object.values(STREET_POINTS).every(pt => (pt?.source ?? '').length > 10));
// Each point was kept only because the geocoder read it back as that road, so
// the name it records has to be the road the label maps to.
([
  ['J.P. Rizal St.', 'J. P. Rizal Street'],
  ['A. Mendoza St.', 'A. Mendoza Street'],
  ['Gov. F. Halili Ave.', 'Governor F. Halili Avenue'],
  ['Violeta Metroville Subd.', 'Violeta Avenue'],
] as [string, string][]).forEach(([label, road]) =>
  ok(`"${label}" sits on ${road}`, (pointForStreet(label)?.source ?? '').startsWith(road),
    pointForStreet(label)?.source));
// The avenue runs for kilometres; the point has to be the stretch by the
// barangay, not whichever end the data happened to list first.
ok('Gov. F. Halili Ave. pins near the barangay, not 1.4km north',
  (pointForStreet('Gov. F. Halili Ave.')?.lat ?? 99) < 14.805,
  JSON.stringify(pointForStreet('Gov. F. Halili Ave.')));
// The local road index is what names a pin that lands between roads.
ok('every mapped street also exists in the road index',
  ['J. P. Rizal Street', 'A. Mendoza Street', 'Governor F. Halili Avenue', 'Violeta Avenue']
    .every(road => !!BARANGAY_ROADS[road]));
// The ones that are not in the map data must stay absent rather than guessed.
(['Ortega Compound', 'Eudenio Compound', 'Ayukit', 'J. Benedicto St.',
  'P. Lazaro St.', 'Gov. F. Halili Ext.', 'Granville Subd.'] as const).forEach(s2 =>
  ok(`"${s2}" has no invented point`, pointForStreet(s2) === null));
ok('an unknown street returns null', pointForStreet('Nowhere Street') === null);

console.log('\n10. abbreviations are expanded the way map data spells them');
([
  ['J.P. Rizal St.', 'J. P. Rizal Street'],
  ['A. Mendoza St.', 'A. Mendoza Street'],
  ['Gov. F. Halili Ave.', 'Governor F. Halili Avenue'],
  ['Gov. F. Halili Ext.', 'Governor F. Halili Extension'],
  ['Violeta Metroville Subd.', 'Violeta Metroville Subdivision'],
  ['Ayukit', 'Ayukit'],
] as [string, string][]).forEach(([from, to]) =>
  ok(`"${from}" -> "${to}"`, expandStreetName(from) === to, expandStreetName(from)));
ok('empty input is safe', expandStreetName('') === '');


console.log('\n11. a pin between roads is named from the road data');
ok('the road index is loaded', Object.keys(BARANGAY_ROADS).length > 40,
  String(Object.keys(BARANGAY_ROADS).length));
ok('every road has at least one point',
  Object.values(BARANGAY_ROADS).every(pts => pts.length > 0));
ok('every point in the index is a valid coordinate',
  Object.values(BARANGAY_ROADS).every(pts => pts.every(([a, b]) => isValidCoordinate(a, b))));
// The exact pin a resident reported as "Not identified".
const screenshotPin = nearestRoad(14.799319, 120.928024);
ok('the reported pin now names a street', !!screenshotPin, JSON.stringify(screenshotPin));
ok('and it is a close one', (screenshotPin?.metres ?? 999) < 200, String(screenshotPin?.metres));
ok('a point on a road reads as nearly zero away',
  (nearestRoad(14.797403, 120.928349)?.metres ?? 999) < 20);
ok('somewhere far away names nothing', nearestRoad(14.2, 120.2) === null);
ok('the range limit is respected', nearestRoad(14.799319, 120.928024, 10) === null);

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
