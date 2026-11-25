/**
 * Dynamic street selection for File a Report (030): the street list follows
 * the incident's place, a chosen street must belong to that place, and the
 * case or referral stores the street exactly as chosen or typed.
 * Run with:  npm run test:incidentstreets
 *
 * Needs prisma/sql/030 applied. AI off for the run. Temporary rows are marked
 * PROBE-IS and removed at the end (one verified street for a fictional
 * barangay, used to test a list outside Biñang 2nd). Fictional data only.
 */
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { signResidentToken } from '../lib/residentAuth';
import { BARANGAY_STREETS } from '../lib/streets';
import { streetIdFor } from '../lib/streetIds';
import { forgetVerifiedStreets } from '../lib/verifiedStreets';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as streetsGET } from '../app/api/registration/streets/route';
import { VERIFIED_RESIDENT, removeTestReferrals } from './residencyFixtures';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-IS';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Body });
const streets = (q: Record<string, string>) => streetsGET(new NextRequest(`http://localhost/api/registration/streets?${new URLSearchParams(q)}`, { headers: { 'x-forwarded-for': `10.60.${process.pid % 250}.1` } })).then(json);
const HALL = { latitude: 14.795956, longitude: 120.9297673 };
const IN = { incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd' };
const BUNLO = { incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Bunlo' };
const NOISE = (n: string) => `Fictional ${n}: malakas na videoke ng kapitbahay tuwing gabi hanggang madaling araw, hindi makatulog ang mga bata. (${TAG} ${process.pid})`;
const FAKE_PLACE = { province: 'Bulacan', municipality: 'Marilao', barangay: `PROBE Fictional ${process.pid}` };
const FAKE_STREET_ID = streetIdFor(FAKE_PLACE.province, FAKE_PLACE.municipality, FAKE_PLACE.barangay, 'Fictional Verified Road');

async function main() {
  process.env.AI_ENABLED = 'false';
  const residents: string[] = []; const caseIds: string[] = []; const refIds: string[] = [];
  const casesWithStreetBefore = await prisma.case.count({ where: { streetId: { not: null } } });
  try {
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Fictional', lastName: 'Streets', age: 30, gender: 'Female',
      barangay: 'Biñang 2nd', address: 'Fictional', contactNumber: '09170000000', emailVerified: true, ...VERIFIED_RESIDENT } as never });
    residents.push(r.id);
    const cookie = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Fictional', role: 'resident' })}`;
    const file = async (body: Body) => {
      const res = await json(await filePOST(new NextRequest('http://localhost/api/resident/cases', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
      if (res.body.data?.caseNumber && res.body.data?.id) caseIds.push(res.body.data.id);
      if (res.body.data?.referral?.id) refIds.push(res.body.data.referral.id);
      return res;
    };

    // ── The street lists ──
    console.log('\nThe street lists');
    const seeded = await prisma.verifiedStreet.findMany({ where: { barangay: 'Biñang 2nd', active: true } });
    ok('Biñang 2nd\'s verified list is the barangay\'s own (the same 12 streets, each with its source)', seeded.length === BARANGAY_STREETS.length
      && BARANGAY_STREETS.every(n => seeded.some(s => s.name === n && s.id === streetIdFor('Bulacan', 'Bocaue', 'Biñang 2nd', n))) && seeded.every(s => /hazard map/.test(s.source)));
    const b2 = await streets({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd' });
    ok('1. Biñang 2nd: the verified street list, P. Lazaro St. included', b2.status === 200 && b2.body.data.verified && b2.body.data.streets.length === 12
      && b2.body.data.streets.some((s: Body) => s.name === 'P. Lazaro St.'));
    ok('...whatever the spelling of the barangay ("Binang II")', (await streets({ province: 'bulacan', municipality: 'BOCAUE', barangay: 'Binang II' })).body.data.streets.length === 12);
    const bunlo = await streets({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Bunlo' });
    ok('2/4. Bunlo: no verified list - so no street is offered (P. Lazaro St. never), and the form asks for the name', bunlo.status === 200
      && bunlo.body.data.identified === true && bunlo.body.data.verified === false && bunlo.body.data.streets.length === 0);
    ok('5. another Bocaue barangay (Taal): not Biñang 2nd\'s streets', (await streets({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal' })).body.data.streets.length === 0);
    ok('another municipality and another province: not Biñang 2nd\'s streets', (await streets({ province: 'Bulacan', municipality: 'Marilao', barangay: 'Lambakin' })).body.data.streets.length === 0
      && (await streets({ province: 'Pampanga', municipality: 'San Fernando', barangay: 'Dolores' })).body.data.streets.length === 0);
    ok('a place not fully given: "not identified" - the form asks for it first', (await streets({ province: 'Bulacan', municipality: 'Bocaue', barangay: '' })).body.data.identified === false);
    await prisma.verifiedStreet.create({ data: { id: FAKE_STREET_ID, ...FAKE_PLACE, name: 'Fictional Verified Road', source: `${TAG} test row (not a real street)` } });
    forgetVerifiedStreets();
    const fake = await streets(FAKE_PLACE);
    ok('3. a barangay that has a verified list gets its own streets - and only those', fake.body.data.verified === true && fake.body.data.streets.length === 1
      && fake.body.data.streets[0].id === FAKE_STREET_ID);

    // ── Saving ──
    console.log('\nWhat is saved');
    const f8 = await file({ description: NOISE('verified outside'), barangay: 'Fictional Verified Road', streetId: FAKE_STREET_ID,
      incidentProvince: FAKE_PLACE.province, incidentMunicipality: FAKE_PLACE.municipality, incidentBarangay: FAKE_PLACE.barangay });
    const r8 = f8.body.data?.referral?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: f8.body.data.referral.id } }) : null;
    ok('8. a verified street outside the jurisdiction: a referral storing that street and its id', f8.body.data?.outcome === 'REFERRAL'
      && r8?.street === 'Fictional Verified Road' && r8?.streetId === FAKE_STREET_ID && r8?.streetManual === false && r8?.barangay === FAKE_PLACE.barangay, `${f8.status} ${f8.body.error ?? ''}`);
    const f9 = await file({ description: NOISE('Bunlo typed'), barangay: 'Fictional Bunlo Road', ...BUNLO });
    const r9 = f9.body.data?.referral?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: f9.body.data.referral.id } }) : null;
    ok('9. Bunlo, the street typed by hand: a referral storing Bunlo and the typed street, marked manual, no street id', f9.body.data?.outcome === 'REFERRAL'
      && r9?.barangay === 'Bunlo' && r9?.street === 'Fictional Bunlo Road' && r9?.streetManual === true && r9?.streetId === null);
    const fSame = await file({ description: NOISE('Bunlo same name'), barangay: 'P. Lazaro St.', ...BUNLO });
    const rSame = fSame.body.data?.referral?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: fSame.body.data.referral.id } }) : null;
    ok('a Bunlo street that shares a name with a Biñang 2nd street is kept as typed - never linked to Biñang 2nd\'s street', rSame?.streetId === null && rSame?.streetManual === true && rSame?.barangay === 'Bunlo');
    const jp = streetIdFor('Bulacan', 'Bocaue', 'Biñang 2nd', 'J.P. Rizal St.');
    const fIn = await file({ description: NOISE('inside'), intakeNarrative: NOISE('inside'), barangay: 'J.P. Rizal St.', streetId: jp, ...IN, ...HALL });
    const cIn = fIn.body.data?.id ? await prisma.case.findUnique({ where: { id: fIn.body.data.id } }) : null;
    ok('12. inside Biñang 2nd: the ordinary case, with the street, its id and the place', Boolean(fIn.body.data?.caseNumber) && cIn?.barangay === 'J.P. Rizal St.'
      && cIn?.streetId === jp && cIn?.streetManual === false && cIn?.incidentBarangay === 'Biñang 2nd' && cIn?.municipality === 'Bocaue', `${fIn.status} ${fIn.body.error ?? ''}`);
    const fLink = await file({ description: NOISE('inside typed'), intakeNarrative: NOISE('inside typed'), barangay: 'J.P. Rizal Street', ...IN, ...HALL });
    const cLink = fLink.body.data?.id ? await prisma.case.findUnique({ where: { id: fLink.body.data.id } }) : null;
    ok('a Biñang 2nd street typed in another spelling is linked to the verified street', cLink?.streetId === jp && cLink?.barangay === 'J.P. Rizal St.' && cLink?.streetManual === false);

    // ── 10. Direct API: a street from another barangay ──
    console.log('\n10. Street ids that do not fit');
    const before10 = await prisma.jurisdictionReferral.count({ where: { residentId: r.id } }) + await prisma.case.count({ where: { residentId: r.id } });
    const lazaro = streetIdFor('Bulacan', 'Bocaue', 'Biñang 2nd', 'P. Lazaro St.');
    const f10 = await file({ description: NOISE('mismatch'), barangay: 'P. Lazaro St.', streetId: lazaro, ...BUNLO });
    ok('10. a Biñang 2nd street id sent with Bunlo: refused (400), nothing saved', f10.status === 400 && f10.body.code === 'STREET_PLACE_MISMATCH');
    const f10b = await file({ description: NOISE('name mismatch'), barangay: 'A. Mendoza St.', streetId: jp, ...IN, ...HALL });
    ok('...a street id with another street\'s name: refused', f10b.status === 400 && f10b.body.code === 'STREET_NAME_MISMATCH');
    const f10c = await file({ description: NOISE('unknown id'), barangay: 'Fictional', streetId: 'bulacan:bocaue:bunlo:made-up-street', ...BUNLO });
    ok('...an id that is not a verified street: refused', f10c.status === 400 && f10c.body.code === 'STREET_NOT_VERIFIED');
    ok('...and none of the three was saved', (await prisma.jurisdictionReferral.count({ where: { residentId: r.id } }) + await prisma.case.count({ where: { residentId: r.id } })) === before10);
    const f11 = await file({ description: NOISE('unlisted inside'), barangay: 'Purok Fictional Sampaguita', ...IN });
    const r11 = f11.body.data?.referral?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: f11.body.data.referral.id } }) : null;
    ok('a street typed for Biñang 2nd that is not on its list: kept as typed, and the place goes to verification', f11.body.data?.outcome === 'LOCATION_VERIFICATION' && r11?.streetManual === true);

    ok('historical cases are untouched (no street id was added to any case but this run\'s)', await prisma.case.count({ where: { streetId: { not: null }, id: { notIn: caseIds } } }) === casesWithStreetBefore);
  } finally {
    await removeTestReferrals(residents);
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { entityId: { in: [...refIds, ...residents] } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { caseId: { in: caseIds } } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.verifiedStreet.deleteMany({ where: { id: FAKE_STREET_ID } });
    forgetVerifiedStreets();
  }
  ok('every test row removed', await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.verifiedStreet.count({ where: { source: { startsWith: TAG } } }) === 0
    // The referrals' notices to real officials are gone too.
    && await prisma.notification.count({ where: { title: { startsWith: 'Referral REF-' }, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
