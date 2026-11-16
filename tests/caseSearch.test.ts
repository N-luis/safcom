/**
 * The case search bar: one input, matched in the database against the case
 * reference, the reporter, the respondent, the incident date and the case
 * type - through the real list routes, for each role. Fictional records only
 * (PROBECS-*), removed at the end. Run with:  npm run test:casesearch
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { parseCaseSearch, parseSearchDate } from '../lib/caseSearch';
import { VAWC_TYPES } from '../lib/vawcTypes';
import { GET as casesGET } from '../app/api/cases/route';
import { GET as vawcGET } from '../app/api/vawc/cases/route';
import { GET as residentGET } from '../app/api/resident/cases/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const TAG = `PROBECS-2026-${process.pid}`;

async function main() {
  console.log('\nReading what was typed');
  for (const f of ['2026-11-14', 'November 14, 2026', 'Nov 14, 2026', 'Nov. 14 2026', '14 November 2026', '14 Nov 2026', '11/14/2026', 'Nobyembre 14, 2026', '  november   14,  2026 ']) {
    ok(`"${f.trim()}" is the incident date 2026-11-14`, parseSearchDate(f)?.date === '2026-11-14', JSON.stringify(parseSearchDate(f)));
  }
  const amb = parseSearchDate('05/06/2026');
  ok('05/06/2026 is read the interface\'s way (month/day) and SAYS so, naming the other reading', amb?.date === '2026-05-06' && /month\/day\/year: May 6, 2026/.test(amb.note ?? '') && /June 5, 2026/.test(amb.note ?? ''), JSON.stringify(amb));
  ok('14/11/2026 can only be day/month - read so, and said', parseSearchDate('14/11/2026')?.date === '2026-11-14' && /day\/month\/year/.test(parseSearchDate('14/11/2026')?.note ?? ''));
  ok('not every input is a date: "Assault", "2026", "11/14", a name, "SC-2026-0051"', ['Assault', '2026', '11/14', 'Nico Luis Orinoco', 'SC-2026-0051'].every(x => parseSearchDate(x) === null));
  ok('a day that does not exist is not a date (2026-02-30, February 30, 2026, 13/13/2026)', ['2026-02-30', 'February 30, 2026', '13/13/2026'].every(x => parseSearchDate(x) === null));
  const p = parseCaseSearch('   Nico    Luis  Orinoco  ');
  ok('spaces are tidied and the name split into words', p?.text === 'Nico Luis Orinoco' && p.tokens.join('|') === 'Nico|Luis|Orinoco' && p.date === null);
  ok('a leading "#" on a reference is dropped; empty input searches nothing', parseCaseSearch('#SC-1')?.text === 'SC-1' && parseCaseSearch('   ') === null);

  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash('PROBECS-unused', 4);
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.cs.${k}.${process.pid}@safcom.local`, name: `Probe ${k}`, password: pw, role } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'), B2 = await mk('blotter2', 'officer'), V = await mk('vawc', 'vawc_officer'), V2 = await mk('vawc2', 'vawc_officer'), A = await mk('admin', 'admin');
    const mkRes = async (n: number, first: string, last: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-R${n}`, firstName: first, lastName: last, barangay: 'Ayukit', address: 'Fictional', age: 34, gender: 'Female', contactNumber: '09170000051', emailVerified: true } });
      residents.push(r.id); return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const R1 = await mkRes(1, 'Nicolo Luisito', 'Probeorin'), R2 = await mkRes(2, 'Other', 'Probeperson');
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const mkCase = async (k: string, data: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${k}`, barangay: 'Ortega Compound', description: 'Fictional search test report', status: 'Open', ...data } as never });
      caseIds.push(c.id); return c;
    };
    // C1: assault, reported by R1, two respondents (one the reporter wrote, one an official added), assigned to B.
    const C1 = await mkCase('0001', { caseType: 'Assault', residentName: 'Nicolo Luisito Probeorin', residentId: R1.id, assignedToId: B.id, incidentDate: d('2026-11-14') });
    await prisma.caseParty.createMany({ data: [
      { caseId: C1.id, role: 'REPORTED', fullName: 'Johndelio Probeco', source: 'reporter' },
      { caseId: C1.id, role: 'REPORTED', fullName: 'Marvino Probeco', source: 'official', updatedById: B.id },
    ] });
    // C2: theft, no respondent recorded, an incident date whose day and month could be swapped.
    const C2 = await mkCase('0002', { caseType: 'Theft & Robbery', residentName: 'Teodora Probesantos', assignedToId: B.id, incidentDate: d('2026-05-06'), filedAt: new Date('2026-05-09T02:00:00Z') });
    // C3: R1 again, but anonymous - the reporter is withheld from officials.
    const C3 = await mkCase('0003', { caseType: 'Noise Complaint', residentName: 'Anonymous reporter', reporterIdentityWithheld: true, residentId: R1.id, assignedToId: B.id });
    // C4: VAWC, assigned to V - reporter, respondent and victim-survivor all different people.
    const C4 = await mkCase('0004', { caseType: 'Domestic Violence', residentName: 'Rosalinda Probevawc', assignedToId: V.id, incidentDate: d('2026-11-14') });
    await prisma.caseParty.createMany({ data: [
      { caseId: C4.id, role: 'REPORTED', fullName: 'Hermogenes Probevawcresp', source: 'reporter' },
      { caseId: C4.id, role: 'AFFECTED', fullName: 'Lualhati Probevictim', source: 'reporter' },
    ] });
    // C5: unassigned blotter case naming the same respondent as C1.
    const C5 = await mkCase('0005', { caseType: 'Public Nuisance', residentName: 'Severino Probeunassigned' });
    await prisma.caseParty.create({ data: { caseId: C5.id, role: 'REPORTED', fullName: 'Johndelio Probeco', source: 'reporter' } });

    const ask = async (cookie: string, q: string, extra = '') => {
      const res = await casesGET(new NextRequest(`http://localhost/api/cases?limit=100&search=${encodeURIComponent(q)}${extra}`, { headers: { Cookie: cookie } }));
      const body = await res.json() as Body;
      return { status: res.status, all: (body.data?.cases ?? []) as Body[], mine: ((body.data?.cases ?? []) as Body[]).filter(c => String(c.caseNumber).startsWith(TAG)).map(c => c.caseNumber.slice(TAG.length + 1)).sort(), total: body.data?.pagination?.total as number, search: body.data?.search };
    };
    const askV = async (cookie: string, q: string, extra = '') => {
      const res = await vawcGET(new NextRequest(`http://localhost/api/vawc/cases?limit=100&search=${encodeURIComponent(q)}${extra}`, { headers: { Cookie: cookie } }));
      const body = await res.json() as Body;
      return { status: res.status, all: (body.data?.cases ?? []) as Body[], mine: ((body.data?.cases ?? []) as Body[]).filter(c => String(c.caseNumber).startsWith(TAG)).map(c => c.caseNumber.slice(TAG.length + 1)).sort(), search: body.data?.search };
    };
    const askR = async (cookie: string, q: string) => {
      const res = await residentGET(new NextRequest(`http://localhost/api/resident/cases?limit=50&search=${encodeURIComponent(q)}`, { headers: { Cookie: cookie } }));
      const body = await res.json() as Body;
      return ((body.data?.cases ?? []) as Body[]).map(c => String(c.caseNumber).slice(TAG.length + 1)).sort();
    };
    const is = (got: string[], want: string[]) => got.join() === want.join();

    console.log('\nReporter / resident name (Case Management)');
    let r = await ask(B.cookie, 'Nicolo Luisito Probeorin');
    ok('full reporter name finds their case - and not the anonymous one they filed', is(r.mine, ['0001']), r.mine.join());
    ok('partial, lower case ("probeorin")', is((await ask(B.cookie, 'probeorin')).mine, ['0001']));
    ok('words in another order, extra spaces ("Probeorin   nicolo")', is((await ask(B.cookie, 'Probeorin   nicolo')).mine, ['0001']));
    ok('part of a first name ("Luisi")', is((await ask(B.cookie, 'Luisi')).mine, ['0001']));

    console.log('\nRespondent / person reported');
    r = await ask(B.cookie, 'Johndelio Probeco');
    ok('full respondent name finds the case it is assigned to', is(r.mine, ['0001']), r.mine.join());
    ok('...not the unassigned case naming the same person (its people are for the assigned officer)', !r.mine.includes('0005'));
    ok('partial respondent name ("johndel")', is((await ask(B.cookie, 'johndel')).mine, ['0001']));
    r = await ask(B.cookie, 'Probeco');
    ok('two respondents on one case match - the case is listed once', r.mine.filter(x => x === '0001').length === 1 && r.all.length === new Set(r.all.map(c => c.id)).size, r.mine.join());
    ok('an official\'s respondent record is searchable by the officer ("Marvino")', is((await ask(B.cookie, 'Marvino')).mine, ['0001']));
    ok('a case with no respondent recorded is still found by its reporter, and not by a respondent search', is((await ask(B.cookie, 'Teodora Probesantos')).mine, ['0002'])
      && !(await ask(B.cookie, 'Johndelio')).mine.includes('0002'));

    console.log('\nIncident date');
    for (const f of ['2026-11-14', 'November 14, 2026', 'Nov 14, 2026', '14 November 2026', '11/14/2026']) {
      r = await ask(B.cookie, f);
      ok(`"${f}" finds the case whose incident date is that day (the VAWC case on the same day stays off this list)`, is(r.mine, ['0001']), r.mine.join());
    }
    ok('...the list says how the date was read', /November 14, 2026/.test(r.search?.note ?? ''), JSON.stringify(r.search));
    r = await ask(B.cookie, '05/06/2026');
    ok('05/06/2026 finds the May 6 case and the note says month/day/year', is(r.mine, ['0002']) && /month\/day\/year/.test(r.search?.note ?? ''), JSON.stringify(r.search));
    ok('the filing date is not the incident date: the day C2 was filed (May 9) does not find it', (await ask(B.cookie, '2026-05-09')).mine.length === 0);

    console.log('\nCase type and reference');
    ok('"assault" (lower case) finds the Assault case', (await ask(B.cookie, 'assault')).mine.includes('0001'));
    ok('"Theft" and "Theft and Robbery" find the Theft & Robbery case', (await ask(B.cookie, 'Theft')).mine.includes('0002') && (await ask(B.cookie, 'Theft and Robbery')).mine.includes('0002'));
    ok('every result of a type search has that type or matches otherwise - no invented types', (await ask(B.cookie, 'Theft')).all.every(c => /theft/i.test(`${c.caseType} ${c.caseNumber} ${c.residentName} ${c.barangay}`)));
    ok('the full reference finds exactly that case', is((await ask(B.cookie, C2.caseNumber)).mine, ['0002']) && (await ask(B.cookie, C2.caseNumber)).total === 1);
    ok('part of the reference, any case, "#" allowed', is((await ask(B.cookie, `#${TAG.toLowerCase()}-0003`)).mine, ['0003']));
    ok('nothing matches: an empty list, not an error', (await ask(B.cookie, 'zzq-no-such-probe-xx')).total === 0);

    console.log('\nPagination, sorting and the other filters still apply');
    const p1 = await ask(B.cookie, TAG, '&limit=2&page=1&sortBy=riskLevel&sortDir=desc'.replace('&limit=2', ''));
    const pg = async (n: number, sort: string) => {
      const res = await casesGET(new NextRequest(`http://localhost/api/cases?limit=2&page=${n}&sortBy=${sort}&sortDir=desc&search=${encodeURIComponent(TAG)}`, { headers: { Cookie: B.cookie } }));
      return (await res.json() as Body).data;
    };
    for (const sort of ['riskLevel', 'filedAt']) {
      const a = await pg(1, sort), b = await pg(2, sort);
      const ids = [...a.cases, ...b.cases].map((c: Body) => c.id);
      ok(`paged by ${sort}: 4 blotter matches over 2 pages, none repeated`, a.pagination.total === 4 && a.pagination.totalPages === 2 && new Set(ids).size === 4, JSON.stringify(a.pagination));
    }
    ok('the same search without paging agrees', p1.total === 4);
    const od = await ask(B.cookie, C1.caseNumber, '&progress=overdue');
    ok('"overdue" plus a search no longer drops the search (the case is new, so nothing is overdue)', od.status === 200 && od.all.every(c => c.caseNumber === C1.caseNumber) && od.total === 0, `${od.total}`);
    ok('a status filter narrows the search', (await ask(B.cookie, TAG, '&status=Closed')).total === 0);

    console.log('\nRoles');
    r = await ask(B2.cookie, 'Johndelio Probeco');
    ok('an officer the cases are not assigned to cannot find them by who is in them', r.mine.length === 0, r.mine.join());
    ok('...but can by reference, type or reporter, as the list already shows those', is((await ask(B2.cookie, C1.caseNumber)).mine, ['0001']) && is((await ask(B2.cookie, 'Probeorin')).mine, ['0001']));
    r = await ask(A.cookie, 'Johndelio Probeco');
    ok('the captain (oversight) finds every case naming the respondent', is(r.mine, ['0001', '0005']), r.mine.join());
    ok('a blotter officer never reaches a VAWC case - by reporter, type, respondent, victim or date', (await Promise.all(['Rosalinda Probevawc', 'Domestic', 'Hermogenes', 'Lualhati', '2026-11-14', C4.caseNumber]
      .map(q => ask(B.cookie, q)))).every(x => !x.mine.includes('0004') && x.all.every(c => !(VAWC_TYPES as readonly string[]).includes(c.caseType))));
    ok('...and the VAWC list is not found for them', (await askV(B.cookie, 'Rosalinda')).status === 404);

    console.log('\nCase Monitoring (VAWC)');
    ok('the VAWC officer finds the case by reporter', is((await askV(V.cookie, 'Rosalinda Probevawc')).mine, ['0004']));
    ok('...by respondent', is((await askV(V.cookie, 'hermogenes')).mine, ['0004']));
    ok('...by victim-survivor', is((await askV(V.cookie, 'Lualhati Probevictim')).mine, ['0004']));
    let rv = await askV(V.cookie, 'November 14, 2026');
    ok('...by incident date - only VAWC cases, with the note', is(rv.mine, ['0004']) && /November 14, 2026/.test(rv.search?.note ?? ''));
    ok('...by category and reference', (await askV(V.cookie, 'domestic')).mine.includes('0004') && is((await askV(V.cookie, C4.caseNumber)).mine, ['0004']));
    ok('a blotter respondent is not found on the VAWC list', (await askV(V.cookie, 'Johndelio')).mine.length === 0);
    ok('another VAWC officer cannot find it by the people in it, only by what the list shows', (await askV(V2.cookie, 'Lualhati')).mine.length === 0
      && (await askV(V2.cookie, 'Hermogenes')).mine.length === 0 && is((await askV(V2.cookie, 'Rosalinda Probevawc')).mine, ['0004']));
    rv = await askV(V.cookie, '', '&type=Assault');
    ok('?type= with a blotter type no longer lists blotter cases on the VAWC list', rv.status === 200 && rv.all.every(c => (VAWC_TYPES as readonly string[]).includes(c.caseType)), rv.all.map(c => c.caseType).join());

    console.log('\nResidents (My Cases)');
    ok('a resident finds their own case by the person they reported', is(await askR(R1.cookie, 'johndelio'), ['0001']));
    ok('...not by a record an official added', (await askR(R1.cookie, 'Marvino')).length === 0);
    ok('...by type, including their own anonymous report', is(await askR(R1.cookie, 'noise'), ['0003']) && is(await askR(R1.cookie, 'Assault'), ['0001']));
    ok('...by incident date', is(await askR(R1.cookie, '14 November 2026'), ['0001']));
    ok('another resident finds none of them, even by reference', (await askR(R2.cookie, C1.caseNumber)).length === 0 && (await askR(R2.cookie, 'Johndelio')).length === 0);
    void C3; void C5;
  } finally {
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.caseParty.count({ where: { caseId: { in: caseIds } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.cs.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
