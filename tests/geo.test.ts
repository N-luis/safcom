/**
 * Coordinate validation and address extraction for the incident location
 * picker.  Run with:  npm run test:geo
 */
import {
  isValidLatitude, isValidLongitude, isValidCoordinate, isWithinBarangay,
  roundCoord, toResolvedLocation, BARANGAY_CENTER,
  DEFAULT_MUNICIPALITY, DEFAULT_PROVINCE,
} from '../lib/geo';

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

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
