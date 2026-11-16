/**
 * Case Management - CSV export, through the real route and database: the
 * period by incident date (a day, a month, a range), one row per case, each
 * desk its own cases, the people only where the official may see them, safe
 * CSV, and the audit trail. Fictional records (PROBE-CSV), filed in March 2001
 * so the counts can be exact; removed at the end.
 * Run with:  npm run test:caseexport   (writes the March file to $CSV_OUT if set)
 */
import { NextRequest } from 'next/server';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { parseExportPeriod, csvCell, toCsv } from '../lib/caseExport';
import { GET as exportGET } from '../app/api/cases/export/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-CSV';

/** A strict RFC 4180 reader - independent of the writer under test. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (ch === '\n') throw new Error(`bare LF outside quotes at ${i}`);
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  console.log('\nThe period');
  const d = parseExportPeriod({ mode: 'date', date: '2026-11-14' });
  ok('a specific date: that day only, named SafeComm_Cases_2026-11-14.csv', !('error' in d) && d.start === '2026-11-14' && d.end === '2026-11-14' && d.filename === 'SafeComm_Cases_2026-11-14.csv');
  const m = parseExportPeriod({ mode: 'month', month: '11', year: '2026' });
  ok('a month: the 1st to the last day, named SafeComm_Cases_November_2026.csv', !('error' in m) && m.start === '2026-11-01' && m.end === '2026-11-30' && m.filename === 'SafeComm_Cases_November_2026.csv');
  const feb = parseExportPeriod({ mode: 'month', month: '2', year: '2028' });
  ok('...February of a leap year ends on the 29th', !('error' in feb) && feb.end === '2028-02-29');
  const r = parseExportPeriod({ mode: 'range', start: '2026-11-01', end: '2026-11-14' });
  ok('a range: both ends included, named SafeComm_Cases_2026-11-01_to_2026-11-14.csv', !('error' in r) && r.start === '2026-11-01' && r.end === '2026-11-14' && r.filename === 'SafeComm_Cases_2026-11-01_to_2026-11-14.csv');
  ok('what cannot be a period is refused with what to fix', ['error' in parseExportPeriod({ mode: 'range', start: '2026-11-14', end: '2026-11-01' }), 'error' in parseExportPeriod({ mode: 'range', start: '2025-01-01', end: '2026-06-01' }),
    'error' in parseExportPeriod({ mode: 'date', date: '2026-02-30' }), 'error' in parseExportPeriod({ mode: 'month', month: '13', year: '2026' }), 'error' in parseExportPeriod({})].every(Boolean));

  console.log('\nWriting CSV safely');
  ok('commas, quotes and line breaks are quoted', csvCell('Dela Cruz, Juan "Jun"') === '"Dela Cruz, Juan ""Jun"""' && csvCell('two\nlines') === '"two\nlines"' && csvCell(null) === '');
  ok('text that starts like a formula is made plain text', ['=1+1', '+639170000000', '-2', '@SUM(A1)', '\tx', '\rx'].every(v => csvCell(v).replace(/^"/, '').startsWith("'")) && csvCell('=x', false) === '=x');
  const sample = toCsv(['A', 'B'], [['ñ', '=cmd']]);
  ok('UTF-8 with a byte-order mark, CRLF line ends', sample.startsWith('﻿') && sample.endsWith('\r\n') && sample.includes('\r\nñ,\'=cmd\r\n'));

  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string, active = true) => {
      const u = await prisma.user.create({ data: { email: `probe.csv.${k}.${process.pid}@safcom.local`, name: `Probe ${k}`, password: pw, role, active } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'), B2 = await mk('blotter2', 'blotter_officer'), V = await mk('vawc', 'vawc_officer'), V2 = await mk('vawc2', 'vawc_officer');
    const A = await mk('captain', 'admin'), SA = await mk('sysadmin', 'system_admin'), OFF = await mk('inactive', 'officer', false);
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Secreta', lastName: 'Probereporter', age: 30, gender: 'Female',
      barangay: 'Ayukit', address: 'Fictional', contactNumber: '09170000099', emailVerified: true } });
    residents.push(R.id);
    const day = (s: string) => new Date(`${s}T00:00:00Z`);
    const mkCase = async (k: string, data: Record<string, unknown>, people: { role: string; fullName: string }[] = []) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${k}`, barangay: 'Ortega Compound', status: 'Open',
        description: `SECRET-NARRATIVE-${k}`, filedAt: new Date('2001-03-02T02:00:00Z'), ...data } as never });
      caseIds.push(c.id);
      for (const p of people) await prisma.caseParty.create({ data: { caseId: c.id, source: 'reporter', ...p } });
      return c;
    };
    // March 2001, by incident date.
    const C1 = await mkCase('C1', { caseType: 'Theft & Robbery', residentName: 'Peñafrancia "Penny" Probeño, Jr.', incidentDate: day('2001-03-05'), assignedToId: B.id,
      filedAt: new Date('2001-03-05T16:30:00Z') }, [{ role: 'REPORTED', fullName: '=HYPERLINK("http://x","click")' }]);
    const C2 = await mkCase('C2', { caseType: 'Noise Complaint', residentName: '@SUM(1+1)', incidentDate: day('2001-03-05') }, [{ role: 'REPORTED', fullName: 'Pedro Probenoise' }]);
    const C3 = await mkCase('C3', { caseType: 'Assault', residentName: 'Line\nBreak Probe', incidentDate: day('2001-03-20'), assignedToId: B.id },
      [{ role: 'REPORTED', fullName: 'Uno Probe' }, { role: 'REPORTED', fullName: 'Dos Probe' }, { role: 'AFFECTED', fullName: 'Affected Probe' }]);
    const C4 = await mkCase('C4', { caseType: 'Domestic Violence', residentName: 'Rosalinda Probevawc', incidentDate: day('2001-03-05'), assignedToId: V.id },
      [{ role: 'REPORTED', fullName: 'Hermogenes Probeperp' }, { role: 'AFFECTED', fullName: 'Lualhati Probevictim' }]);
    const C5 = await mkCase('C5', { caseType: 'Vandalism', residentName: 'Last Day Probe', incidentDate: day('2001-03-31') });
    const C6 = await mkCase('C6', { caseType: 'Vandalism', residentName: 'April Probe', incidentDate: day('2001-04-01') });
    const C7 = await mkCase('C7', { caseType: 'Vandalism', residentName: 'February Probe', incidentDate: day('2001-02-28') });
    const C8 = await mkCase('C8', { caseType: 'Other', residentName: 'Anonymous reporter', reporterIdentityWithheld: true, residentId: R.id, incidentDate: day('2001-03-10') });
    const C9 = await mkCase('C9', { caseType: 'Other', residentName: 'No Date Probe', incidentDate: null, filedAt: new Date('2001-03-12T02:00:00Z') });
    void C6; void C7; void C9;

    const get = async (cookie: string, q: string) => {
      const res = await exportGET(new NextRequest(`http://localhost/api/cases/export?${q}`, { headers: { Cookie: cookie } }));
      const isCsv = (res.headers.get('content-type') ?? '').startsWith('text/csv');
      // The raw bytes, decoded keeping a byte-order mark (Response.text() would drop it).
      const bytes = isCsv ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
      const text = isCsv ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) : '';
      const body = isCsv ? {} : await res.json().catch(() => ({})) as { error?: string; undated?: number };
      const rows = isCsv ? parseCsv(text.replace(/^﻿/, '')) : [];
      return { status: res.status, headers: res.headers, text, body, header: rows[0] ?? [], rows: rows.slice(1), refs: rows.slice(1).map(x => x[0].split('-').pop()!).sort() };
    };
    const col = (rows: string[][], header: string[], ref: string, name: string) => rows.find(x => x[0].endsWith(`-${ref}`))?.[header.indexOf(name)];

    console.log('\n1. One specific date');
    const one = await get(B.cookie, 'mode=date&date=2001-03-05');
    ok('the blotter cases with that incident date (the VAWC case that day is not theirs)', one.status === 200 && one.refs.join() === 'C1,C2', one.refs.join());
    ok('a downloadable CSV named for the day', /text\/csv; charset=utf-8/.test(one.headers.get('content-type') ?? '') && one.headers.get('content-disposition') === 'attachment; filename="SafeComm_Cases_2001-03-05.csv"'
      && one.headers.get('cache-control') === 'no-store, private' && one.headers.get('x-export-count') === '2');
    ok('the columns', one.header.join('|') === 'Case Reference|Incident Date|Case Type|Reporting Desk|Status|Reporter|Respondent(s)|Assigned Officer|Date Reported (PH time)|Last Updated (PH time)', one.header.join('|'));

    console.log('\n2. A whole month');
    const mar = await get(B.cookie, 'mode=month&month=3&year=2001');
    ok('every blotter case with an incident date in March - the 1st through the 31st', mar.status === 200 && mar.refs.join() === 'C1,C2,C3,C5,C8', mar.refs.join());
    ok('...not April 1 or February 28, and never by the filing date (C9 was filed in March, no incident date)', !mar.refs.includes('C6') && !mar.refs.includes('C7') && !mar.refs.includes('C9'));
    ok('named SafeComm_Cases_March_2001.csv', mar.headers.get('content-disposition') === 'attachment; filename="SafeComm_Cases_March_2001.csv"');
    if (process.env.CSV_OUT) fs.writeFileSync(process.env.CSV_OUT, mar.text, 'utf8');

    console.log('\n3. A custom range');
    const rng = await get(B.cookie, 'mode=range&start=2001-03-05&end=2001-03-20');
    ok('from the start date through the whole end date', rng.status === 200 && rng.refs.join() === 'C1,C2,C3,C8', rng.refs.join());

    console.log('\n4. Nothing in the period');
    const none = await get(B.cookie, 'mode=date&date=2001-01-15');
    ok('"No cases found for the selected period" - and no file', none.status === 404 && none.body.error === 'No cases found for the selected period' && none.text === '');
    ok('...with how many of their cases have no incident date at all', typeof none.body.undated === 'number' && none.body.undated! >= 1);

    console.log('\n5-6. Counts and duplicates');
    const dbCount = await prisma.case.count({ where: { caseNumber: { startsWith: TAG }, caseType: { notIn: ['Domestic Violence', 'Child Abuse', 'Rape', 'Sexual Harassment', 'VAWC - Other'] }, incidentDate: { gte: day('2001-03-01'), lte: day('2001-03-31') } } });
    ok('the file has exactly as many rows as the database has matching cases', mar.rows.length === dbCount && mar.headers.get('x-export-count') === String(dbCount), `${mar.rows.length} vs ${dbCount}`);
    ok('a case with two respondents is one row, both named', mar.refs.filter(x => x === 'C3').length === 1 && col(mar.rows, mar.header, 'C3', 'Respondent(s)') === 'Uno Probe; Dos Probe');

    console.log('\n7. Residents and roles that may not export');
    ok('a resident session: refused', (await get(`resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'x', role: 'resident' })}`, 'mode=month&month=3&year=2001')).status === 401);
    ok('no session: refused', (await get('', 'mode=month&month=3&year=2001')).status === 401);
    ok('the system administrator (IT): refused', (await get(SA.cookie, 'mode=month&month=3&year=2001')).status === 403);
    ok('a deactivated official: refused', (await get(OFF.cookie, 'mode=month&month=3&year=2001')).status === 401);
    ok('a bad period: refused with what to fix', (await get(B.cookie, 'mode=range&start=2001-03-20&end=2001-03-05')).status === 400);

    console.log('\n8. Blotter officials: only what they may see');
    ok('respondent named on their assigned case; "(restricted)" on a case not assigned to them - never a guess, never blank', col(mar.rows, mar.header, 'C1', 'Respondent(s)')?.endsWith('=HYPERLINK("http://x","click")') === true
      && col(mar.rows, mar.header, 'C2', 'Respondent(s)') === '(restricted)' && col(mar.rows, mar.header, 'C5', 'Respondent(s)') === '' && mar.headers.get('x-export-restricted') === '1');
    const mar2 = await get(B2.cookie, 'mode=month&month=3&year=2001');
    ok('another blotter official: the same cases, every respondent restricted', mar2.refs.join() === 'C1,C2,C3,C5,C8' && ['C1', 'C2', 'C3'].every(k => col(mar2.rows, mar2.header, k, 'Respondent(s)') === '(restricted)'));
    ok('an anonymous report says "Anonymous reporter" - not the resident behind it', col(mar.rows, mar.header, 'C8', 'Reporter') === 'Anonymous reporter' && !mar.text.includes('Probereporter'));
    ok('no narrative, contact number or victim-survivor in any file', ![mar.text, mar2.text].some(t => /SECRET-NARRATIVE|09170000099|Affected Probe|Lualhati/.test(t)));

    console.log('\n9. VAWC confidentiality');
    ok('a blotter official never gets a VAWC case', [one, mar, rng, mar2].every(x => !x.refs.includes('C4') && !x.text.includes('VAWC,')));
    const vm = await get(V.cookie, 'mode=month&month=3&year=2001');
    ok('the VAWC officer exports the VAWC desk\'s cases only - their own desk', vm.status === 200 && vm.refs.join() === 'C4' && col(vm.rows, vm.header, 'C4', 'Reporting Desk') === 'VAWC', vm.refs.join());
    ok('...the alleged perpetrator on their assigned case; the victim-survivor never', col(vm.rows, vm.header, 'C4', 'Respondent(s)') === 'Hermogenes Probeperp' && !vm.text.includes('Lualhati') && !vm.text.includes('SECRET-NARRATIVE'));
    const vm2 = await get(V2.cookie, 'mode=month&month=3&year=2001');
    ok('another VAWC officer: the case, but the people restricted', vm2.refs.join() === 'C4' && col(vm2.rows, vm2.header, 'C4', 'Respondent(s)') === '(restricted)');
    const am = await get(A.cookie, 'mode=month&month=3&year=2001');
    ok('the Punong Barangay: both desks, the people named - still no victim-survivor', am.refs.join() === 'C1,C2,C3,C4,C5,C8' && col(am.rows, am.header, 'C2', 'Respondent(s)') === 'Pedro Probenoise'
      && col(am.rows, am.header, 'C4', 'Reporting Desk') === 'VAWC' && !am.text.includes('Lualhati'));

    console.log('\n10-11. Opens correctly; special characters and formulas are safe');
    ok('UTF-8 with a byte-order mark (EF BB BF); every row has all 10 columns', mar.text.startsWith('﻿') && mar.rows.every(x => x.length === 10));
    ok('a name with a comma, quotes and "ñ" reads back exactly', col(mar.rows, mar.header, 'C1', 'Reporter') === 'Peñafrancia "Penny" Probeño, Jr.');
    ok('a name with a line break stays one cell', col(mar.rows, mar.header, 'C3', 'Reporter') === 'Line\nBreak Probe');
    ok('formula-like text is written as plain text (prefixed with \')', col(mar.rows, mar.header, 'C1', 'Respondent(s)') === '\'=HYPERLINK("http://x","click")' && col(mar.rows, mar.header, 'C2', 'Reporter') === "'@SUM(1+1)");
    ok('dates: the incident day as given; reported/updated in Philippine time', col(mar.rows, mar.header, 'C1', 'Incident Date') === '2001-03-05' && col(mar.rows, mar.header, 'C1', 'Date Reported (PH time)') === '2001-03-06 00:30'
      && col(mar.rows, mar.header, 'C5', 'Assigned Officer') === 'Unassigned' && col(mar.rows, mar.header, 'C1', 'Assigned Officer') === 'Probe blotter');

    console.log('\nThe audit trail');
    const logs = await prisma.reporterAccessLog.findMany({ where: { actorId: B.id, code: 'case_export', reason: { contains: 'March 2001' } } });
    ok('each exported case records who exported it, when, the period and the count', logs.length === 5 && logs.every(l => l.outcome === 'permitted' && l.actorRole === 'officer' && /CSV export, March 2001: 5 cases \(export [0-9a-f-]{36}\)/.test(l.reason ?? '') && l.createdAt instanceof Date)
      && new Set(logs.map(l => l.caseId)).size === 5, `${logs.length} ${logs[0]?.reason}`);
    ok('nothing is logged as exported when nothing was', (await prisma.reporterAccessLog.count({ where: { actorId: B.id, code: 'case_export', reason: { contains: '2001-01-15' } } })) === 0);
    void C1; void C2; void C3; void C4; void C5; void C8;
  } finally {
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  const left = { cases: await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }), users: await prisma.user.count({ where: { email: { startsWith: 'probe.csv.' } } }),
    logs: await prisma.reporterAccessLog.count({ where: { caseId: { in: caseIds } } }) };
  ok('every test row removed', Object.values(left).every(n => n === 0), JSON.stringify(left));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
