/**
 * VAWC Case Monitoring - Export CSV, through the real routes and the real
 * database (in-process). Run with:  npm run test:vawcexport
 *
 * Fictional records only, marked PROBE-VX and removed at the end. More cases
 * than one batch are made, so the export is shown to read past every batch
 * and every page of the list.
 */
import fs from 'fs';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { VAWC_TYPES } from '../lib/vawcTypes';
import { BATCH, VAWC_EXPORT_HEADERS, RESTRICTED } from '../lib/vawcCaseExportServer';
import { GET as exportGET } from '../app/api/vawc/cases/export/route';
import { GET as listGET } from '../app/api/vawc/cases/route';
import { GET as blotterExportGET } from '../app/api/cases/export/route';
import { GET as attachmentGET } from '../app/api/attachments/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-VX';
const req = (path: string, cookie: string) => new NextRequest(`http://localhost${path}`, { headers: { Cookie: cookie } });

/** RFC 4180 reader: quoted cells with commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const users: string[] = []; const residents: string[] = [];
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.vx.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: '!unusable', role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mk('vawc', 'vawc_officer');
    const V2 = await mk('vawc2', 'vawc_officer');
    const C = await mk('captain', 'admin');
    const B = await mk('blotter', 'officer');
    const SA = await mk('sysadmin', 'system_admin');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Resident', age: 30, gender: 'Female', barangay: 'Ayukit', address: 'x', emailVerified: true } });
    residents.push(R.id);
    const rCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Probe', role: 'resident' })}`;

    // More VAWC cases than one batch, plus blotter cases, all fictional.
    const N = BATCH * 2 + 37;
    const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 3_600_000);
    const all = Array.from({ length: N }, (_, i) => ({
      caseNumber: `${TAG}-V-${process.pid}-${String(i).padStart(5, '0')}`, residentName: `Fictional Reporter ${i}`, caseType: VAWC_TYPES[i % VAWC_TYPES.length],
      barangay: 'Probe St', description: `PROBE-NARRATIVE ${i}`, status: ['Open', 'In Progress', 'Resolved', 'Closed'][i % 4], riskLevel: i % 5 === 0 ? null : 'High',
      assignedToId: i % 2 === 0 ? V.id : null, filedAt: day(i), incidentDate: i % 3 === 0 ? null : new Date(Date.UTC(2023, 11, 1 + (i % 28))),
    }));
    for (let i = 0; i < all.length; i += 100) await prisma.case.createMany({ data: all.slice(i, i + 100) });
    await prisma.case.createMany({ data: Array.from({ length: 5 }, (_, i) => ({
      caseNumber: `${TAG}-B-${process.pid}-${i}`, residentName: 'Fictional Blotter', caseType: 'Noise Complaint', barangay: 'Probe St', description: 'x', status: 'Open',
      assignedToId: B.id, incidentDate: new Date(Date.UTC(2023, 11, 5)),
    })) });
    const vCases = await prisma.case.findMany({ where: { caseNumber: { startsWith: `${TAG}-V-${process.pid}` } }, orderBy: { caseNumber: 'asc' }, select: { id: true, caseNumber: true } });
    const K = vCases[0]; // assigned to V
    const KU = vCases[1]; // unassigned
    // The awkward one: commas, quotes, a line break and a spreadsheet formula, typed by a person.
    await prisma.case.update({ where: { id: K.id }, data: { residentName: '=HYPERLINK("http://evil.example","click"), "Ana", Line\nTwo', reportingRelationship: 'THIRD_PARTY' } });
    // Several people on one case: still one row.
    await prisma.caseParty.createMany({ data: [
      { caseId: K.id, role: 'AFFECTED', fullName: 'Fictional Survivor One', source: 'official' },
      { caseId: K.id, role: 'AFFECTED', fullName: 'Fictional Survivor Two', source: 'official' },
      { caseId: K.id, role: 'REPORTED', fullName: 'Fictional Respondent A', source: 'reporter' },
      { caseId: K.id, role: 'REPORTED', fullName: 'Fictional Respondent B', source: 'reporter' },
      { caseId: KU.id, role: 'REPORTED', fullName: 'Fictional Respondent C', source: 'reporter' },
    ] });
    await prisma.caseVictimSurvivor.create({ data: { caseId: K.id, clientCode: 'VX-001', sexAtBirth: 'female', ageAtIncident: 29, recordedById: V.id } });
    const anon = vCases[2];
    await prisma.case.update({ where: { id: anon.id }, data: { residentName: 'Anonymous reporter', reporterIdentityWithheld: true, residentId: R.id } });
    // Evidence on the case: a photo whose name and bytes must never reach the file.
    const photo = await prisma.caseAttachment.create({ data: { caseId: K.id, filename: 'PROBE-EVIDENCE-photo.jpg', mimeType: 'image/png', size: 8,
      data: Buffer.from('PROBEIMG'), uploadedByResidentId: R.id } });

    const run = async (cookie: string) => {
      const res = await exportGET(req('/api/vawc/cases/export', cookie));
      // Read as bytes: Response.text() would drop the byte-order mark this test checks for.
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      return { res, bom: bytes ? bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf : false,
        text: bytes ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) : '', body: res.ok ? null : await res.json().catch(() => ({})) };
    };

    console.log('\nThe file');
    const { res, text, bom } = await run(V.cookie);
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    ok('a CSV download (200), UTF-8, named SafeComm_VAWC_All_Cases_<today>.csv', res.status === 200 && /text\/csv; charset=utf-8/.test(res.headers.get('Content-Type') ?? '')
      && res.headers.get('Content-Disposition') === `attachment; filename="SafeComm_VAWC_All_Cases_${today}.csv"`, `${res.status} ${res.headers.get('Content-Disposition')}`);
    ok('starts with a UTF-8 byte-order mark and the header row', bom && text.startsWith('﻿') && parseCsv(text.slice(1))[0].join() === VAWC_EXPORT_HEADERS.join());
    const rows = parseCsv(text.slice(1)).slice(1);
    const refs = rows.map(r => r[0]);
    const dbVawc = await prisma.case.count({ where: { caseType: { in: [...VAWC_TYPES] } } });
    ok(`every VAWC case in the database - ${dbVawc} - past every batch of ${BATCH}`, rows.length === dbVawc && Number(res.headers.get('X-Export-Count')) === dbVawc, `${rows.length} vs ${dbVawc}`);
    ok(`all ${N} test cases are in it, each exactly once`, vCases.every(c => refs.filter(r => r === c.caseNumber).length === 1));
    ok('no duplicate row at all', new Set(refs).size === refs.length);
    ok('every row has every column', rows.every(r => r.length === VAWC_EXPORT_HEADERS.length));
    ok('no blotter case', !refs.some(r => r.startsWith(`${TAG}-B-`)) && rows.every(r => (VAWC_TYPES as readonly string[]).includes(r[1])));
    ok('cases with no incident date or risk level are still exported', rows.some(r => r[0] === vCases[0].caseNumber && r[2] === '') && rows.some(r => r[0] === vCases[5].caseNumber && r[6] === 'Undetermined'));
    const kRow = rows.find(r => r[0] === K.caseNumber)!;
    ok('commas, quotes and line breaks survive; the formula is made harmless', kRow[9] === `'=HYPERLINK("http://evil.example","click"), "Ana", Line\nTwo`);
    ok('the officer it is assigned to sees the people: both victim-survivors, both reported, the record', kRow[11] === 'Fictional Survivor One; Fictional Survivor Two'
      && kRow[13] === 'Fictional Respondent A; Fictional Respondent B' && kRow[12] === 'Client code VX-001, female, age 29' && kRow[10] === 'It involves someone else' && kRow[8] === V.name);
    ok('an anonymous report is never named', rows.find(r => r[0] === anon.caseNumber)?.[9] === 'Anonymous reporter');
    ok('not assigned to them: the people are "(restricted)", the case is still listed', rows.find(r => r[0] === KU.caseNumber)?.[13] === RESTRICTED);

    console.log('\nNo evidence, no narrative');
    ok('no image name, bytes, path, URL or base64 in the file', !text.includes('PROBE-EVIDENCE') && !text.includes('PROBEIMG') && !text.includes(Buffer.from('PROBEIMG').toString('base64'))
      && !/\/api\/attachments|storage|data:image|\.jpg|\.png/i.test(text));
    ok('no narrative', !text.includes('PROBE-NARRATIVE'));
    ok('the export code never selects attachments, the narrative or contact details', !/attachments|description|contactNumber|data:|filename:|password|email|clerkId/.test(
      fs.readFileSync('lib/vawcCaseExportServer.ts', 'utf8').split('const caseSelect')[1].split('} as const;')[0]));
    const evidence = await attachmentGET(req(`/api/attachments/${photo.id}`, V.cookie), { params: Promise.resolve({ id: photo.id }) });
    ok('the evidence is still there in the case, for the officer it is assigned to', evidence.status === 200 && Buffer.from(await evidence.arrayBuffer()).toString() === 'PROBEIMG'
      && (await prisma.caseAttachment.count({ where: { id: photo.id } })) === 1);

    console.log('\nWho may export');
    const capt = await run(C.cookie);
    ok('the Punong Barangay: every VAWC case, people shown', capt.res.status === 200 && parseCsv(capt.text.slice(1)).slice(1).find(r => r[0] === KU.caseNumber)?.[13] === 'Fictional Respondent C');
    const other = await run(V2.cookie);
    ok('another VAWC officer: every VAWC case, the people restricted on cases not theirs', other.res.status === 200
      && parseCsv(other.text.slice(1)).slice(1).find(r => r[0] === K.caseNumber)?.[11] === RESTRICTED);
    ok('a blotter officer: not found, no file', (await run(B.cookie)).res.status === 404);
    ok('the system administrator: not found, no file', (await run(SA.cookie)).res.status === 404);
    ok('a resident session, or none: refused', (await run(rCookie)).res.status === 401 && (await run('')).res.status === 401);
    const logged = await prisma.reporterAccessLog.count({ where: { actorId: V.id, code: 'vawc_case_export' } });
    ok('the export is in the access log, one row per exported case', logged === dbVawc, `${logged}`);

    console.log('\nThe rest still works');
    const page2 = await listGET(req('/api/vawc/cases?limit=15&page=2', V.cookie));
    const p2 = (await page2.json()).data;
    ok('Case Monitoring still pages 15 at a time over the same cases', page2.status === 200 && p2.cases.length === 15 && p2.total === dbVawc);
    const filtered = (await (await listGET(req(`/api/vawc/cases?limit=15&search=${encodeURIComponent(K.caseNumber)}`, V.cookie))).json()).data;
    ok('and its search still finds a case', filtered.cases.some((c: { id: string }) => c.id === K.id));
    const blotter = await blotterExportGET(req('/api/cases/export?mode=range&start=2023-12-01&end=2023-12-31', B.cookie));
    const bText = blotter.ok ? await blotter.text() : '';
    ok('the Blotter export still works, and still holds no VAWC case', blotter.status === 200 && bText.includes(`${TAG}-B-`) && !bText.includes(`${TAG}-V-`));
  } finally {
    const ids = (await prisma.case.findMany({ where: { caseNumber: { startsWith: TAG } }, select: { id: true } })).map(c => c.id);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: ids } }, { actorId: { in: users } }] } });
    });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: ids } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.vx.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
