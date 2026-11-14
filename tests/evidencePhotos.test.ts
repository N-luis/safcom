/**
 * Evidence photos, end to end through the real routes and database (in-process):
 * a resident files a report with photos, retries safely, adds a follow-up photo;
 * officials list and open them; nobody else can. Fictional records (PROBE-EVT),
 * removed at the end. The AI is turned off and no outside call is made.
 * Run with:  npm run test:evidencephotos
 */
process.env.AI_ENABLED = 'false';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { createCanvas } from '@napi-rs/canvas';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { POST as residentFollowUpPOST } from '../app/api/resident/cases/[id]/follow-ups/route';
import { GET as staffEvidenceGET } from '../app/api/cases/[id]/evidence/route';
import { GET as residentEvidenceGET } from '../app/api/resident/cases/[id]/evidence/route';
import { GET as imageGET } from '../app/api/attachments/[id]/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const TAG = 'PROBE-EVT';
// Nothing leaves the machine during this test.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => { throw new Error(`blocked outside call: ${String(url).slice(0, 60)}`); }) as typeof fetch;

const photo = (hue: number, w = 640, h = 480) => {
  const c = createCanvas(w, h); const g = c.getContext('2d');
  g.fillStyle = `hsl(${hue},60%,50%)`; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(hue % 300, 40, 120, 80);
  return c.toBuffer('image/jpeg');
};
const dataUrl = (b: Buffer, type = 'image/jpeg') => `data:${type};base64,${b.toString('base64')}`;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Body });
const P = (id: string) => ({ params: Promise.resolve({ id }) });

async function main() {
  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.evt.${k}.${process.pid}@safcom.local`, name: `Probe ${k}`, password: pw, role } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'), V = await mk('vawc', 'vawc_officer'), SA = await mk('sysadmin', 'system_admin');
    const mkRes = async (n: number) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-${n}`, firstName: 'Evidencia', lastName: `Probe${n}`, age: 30, gender: 'Female',
        barangay: 'Ayukit', address: 'Fictional', contactNumber: '09170000071', emailVerified: true } });
      residents.push(r.id); return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Evidencia', role: 'resident' })}` };
    };
    const R = await mkRes(1), R2 = await mkRes(2);
    const file = async (cookie: string, extra: Body) => {
      const text = 'Fictional evidence test: someone broke the gate and took the bicycle from the yard last night.';
      const out = await json(await filePOST(req('/api/resident/cases', cookie, 'POST', {
        description: text, intakeNarrative: text, reportingRelationship: 'SELF', intakeAnswers: [], barangay: 'Ayukit', ...extra })));
      if (out.body?.data?.id && !caseIds.includes(out.body.data.id)) caseIds.push(out.body.data.id);
      return out;
    };
    const A = photo(10), Bp = photo(120), C = photo(240), D = photo(300);

    console.log('\n1-3. A resident uploads one photo, then several, and submits');
    const one = await file(R.cookie, { submissionKey: `${TAG}-one-${process.pid}`, attachments: [{ name: 'gate.jpg', dataUrl: dataUrl(A) }] });
    ok('one photo: the case is filed', one.status === 201, `${one.status} ${one.body.error ?? ''}`);
    let rows = await prisma.caseAttachment.findMany({ where: { caseId: one.body.data.id } });
    ok('...and the photo is stored on that case, the bytes exactly as sent', rows.length === 1 && sha(rows[0].data) === sha(A) && rows[0].mimeType === 'image/jpeg' && rows[0].filename === 'gate.jpg');
    ok('...with its fingerprint, who uploaded it, and when', rows[0].sha256 === sha(A) && rows[0].uploadedByResidentId === R.id && rows[0].uploadedByUserId === null && rows[0].createdAt instanceof Date);
    const many = await file(R.cookie, { submissionKey: `${TAG}-many-${process.pid}`, attachments: [
      { name: 'front.jpg', dataUrl: dataUrl(A) }, { name: 'side.jpg', dataUrl: dataUrl(Bp) }, { name: 'front-again.jpg', dataUrl: dataUrl(A) }] });
    rows = await prisma.caseAttachment.findMany({ where: { caseId: many.body.data.id }, orderBy: { createdAt: 'asc' } });
    ok('several photos: each stored once - the same photo sent twice is kept once', many.status === 201 && rows.length === 2 && new Set(rows.map(r => r.sha256)).size === 2, rows.map(r => r.filename).join());
    ok('no browser URL is stored - only the image bytes and their metadata', rows.every(r => !/^blob:|^data:/.test(r.filename) && r.data.length > 1000));

    console.log('\nRetrying never files twice');
    const again = await file(R.cookie, { submissionKey: `${TAG}-many-${process.pid}`, attachments: [{ name: 'front.jpg', dataUrl: dataUrl(A) }, { name: 'side.jpg', dataUrl: dataUrl(Bp) }] });
    ok('the same submission again returns the case already filed', again.status === 200 && again.body.data.duplicate === true && again.body.data.id === many.body.data.id && again.body.data.photosAdded === 0);
    ok('...one case for that key, still two photos', (await prisma.case.count({ where: { residentId: R.id, submissionKey: `${TAG}-many-${process.pid}` } })) === 1
      && (await prisma.caseAttachment.count({ where: { caseId: many.body.data.id } })) === 2);
    const fill = await file(R.cookie, { submissionKey: `${TAG}-many-${process.pid}`, attachments: [{ name: 'front.jpg', dataUrl: dataUrl(A) }, { name: 'back.jpg', dataUrl: dataUrl(C) }] });
    ok('a retry carrying a photo that did not arrive the first time adds just that one', fill.body.data.photosAdded === 1 && (await prisma.caseAttachment.count({ where: { caseId: many.body.data.id } })) === 3);
    // Several rounds of three taps at once: the outcome must be the same every time, not just usually.
    const rounds: string[] = [];
    for (let round = 1; round <= 5; round++) {
      const key = `${TAG}-race-${process.pid}-${round}`;
      const rs = await Promise.all([1, 2, 3].map(() => file(R.cookie, { submissionKey: key, attachments: [{ name: 'race.jpg', dataUrl: dataUrl(D) }] })));
      const cases = await prisma.case.count({ where: { residentId: R.id, submissionKey: key } });
      const photos = await prisma.caseAttachment.count({ where: { caseId: rs[0].body.data?.id ?? '-' } });
      const sameCase = rs.every(x => x.body.data?.id === rs[0].body.data?.id);
      if (cases !== 1 || photos !== 1 || !sameCase) rounds.push(`round ${round}: ${cases} cases, ${photos} photos, statuses ${rs.map(x => x.status).join('/')}`);
    }
    ok('three taps at the same moment, five times over: always one case and one photo', rounds.length === 0, rounds.join('; '));

    console.log('\n9. Upload failures are refused with a clear reason - and nothing is filed');
    const before = await prisma.case.count({ where: { residentId: R.id } });
    const gif = await file(R.cookie, { attachments: [{ name: 'animation.gif', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }] });
    ok('a GIF: refused, naming the file and what is accepted', gif.status === 400 && /animation\.gif: Only JPG, PNG and WEBP/.test(gif.body.error ?? ''), gif.body.error);
    const big = await file(R.cookie, { attachments: [{ name: 'huge.jpg', dataUrl: `data:image/jpeg;base64,${Buffer.alloc(2.2 * 1024 * 1024, 1).toString('base64')}` }] });
    ok('a photo over 2 MB: refused, naming the file and the limit', big.status === 400 && /huge\.jpg: Each photo must be under 2 MB/.test(big.body.error ?? ''), big.body.error);
    ok('four photos: refused with the limit', (await file(R.cookie, { attachments: [A, Bp, C, D].map((b, i) => ({ name: `p${i}.jpg`, dataUrl: dataUrl(b) })) })).status === 400);
    ok('...none of these filed a case', (await prisma.case.count({ where: { residentId: R.id } })) === before);

    console.log('\n4-5. Stored, so they are there after a refresh - and an official sees them');
    const caseId = many.body.data.id as string;
    const staffList = await json(await staffEvidenceGET(req(`/api/cases/${caseId}/evidence`, B.cookie), P(caseId)));
    ok('a blotter officer lists the case\'s evidence: filename, type, size, date, uploader', staffList.status === 200 && staffList.body.data.items.length === 3
      && staffList.body.data.items.every((i: Body) => i.filename && i.mimeType === 'image/jpeg' && i.size > 0 && !Number.isNaN(Date.parse(i.createdAt)) && i.uploadedBy === 'The reporter'));
    const first = staffList.body.data.items.find((i: Body) => i.filename === 'front.jpg');
    const img = await imageGET(req(`/api/attachments/${first.id}`, B.cookie), P(first.id));
    const bytes = Buffer.from(await img.arrayBuffer());
    ok('photos sent together keep the order they were picked in', staffList.body.data.items.map((i: Body) => i.filename).join() === 'front.jpg,side.jpg,back.jpg', staffList.body.data.items.map((i: Body) => i.filename).join());
    ok('...and opens it: the exact stored image, inline, private, not sniffable', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && sha(bytes) === sha(A)
      && /^inline;/.test(img.headers.get('content-disposition') ?? '') && /private/.test(img.headers.get('cache-control') ?? '') && img.headers.get('x-content-type-options') === 'nosniff');
    const dl = await imageGET(req(`/api/attachments/${first.id}?download=1`, B.cookie), P(first.id));
    ok('8. download: the original as a file named as uploaded', dl.status === 200 && /^attachment; filename="front\.jpg"/.test(dl.headers.get('content-disposition') ?? ''), dl.headers.get('content-disposition') ?? '');
    ok('...and taking a copy is in the access log', (await prisma.reporterAccessLog.count({ where: { caseId, actorId: B.id, fields: { has: 'evidence_download' } } })) === 1);
    ok('the case page still lists them too (older screens keep working)', (await json(await caseGET(req(`/api/cases/${caseId}`, B.cookie), P(caseId)))).body.data.attachments.length === 3);

    console.log('\n6. A VAWC case\'s evidence: the VAWC desk only');
    const vc = await prisma.case.create({ data: { caseNumber: `${TAG}-V-${process.pid}`, residentName: 'Evidencia Probe1', caseType: 'Domestic Violence', barangay: 'Ayukit',
      description: 'Fictional', status: 'Open', residentId: R.id, assignedToId: V.id } });
    caseIds.push(vc.id);
    const vAtt = await prisma.caseAttachment.create({ data: { caseId: vc.id, filename: 'bruise.jpg', mimeType: 'image/jpeg', size: C.length, data: new Uint8Array(C), sha256: sha(C), uploadedByResidentId: R.id } });
    ok('the VAWC officer lists and opens it', (await json(await staffEvidenceGET(req(`/api/cases/${vc.id}/evidence`, V.cookie), P(vc.id)))).body.data.items.length === 1
      && (await imageGET(req(`/api/attachments/${vAtt.id}`, V.cookie), P(vAtt.id))).status === 200);

    console.log('\n7. Nobody else');
    ok('a blotter officer: the VAWC evidence list and image are not found', (await staffEvidenceGET(req(`/api/cases/${vc.id}/evidence`, B.cookie), P(vc.id))).status === 404
      && (await imageGET(req(`/api/attachments/${vAtt.id}`, B.cookie), P(vAtt.id))).status === 404);
    ok('the system administrator (an IT role): not found either', (await staffEvidenceGET(req(`/api/cases/${vc.id}/evidence`, SA.cookie), P(vc.id))).status === 404
      && (await imageGET(req(`/api/attachments/${vAtt.id}`, SA.cookie), P(vAtt.id))).status === 404);
    ok('no session: refused', (await imageGET(req(`/api/attachments/${first.id}`, ''), P(first.id))).status === 401
      && (await staffEvidenceGET(req(`/api/cases/${caseId}/evidence`, ''), P(caseId))).status === 401);
    ok('another resident: refused, and the list is not found', (await imageGET(req(`/api/attachments/${first.id}`, R2.cookie), P(first.id))).status === 403
      && (await residentEvidenceGET(req(`/api/resident/cases/${caseId}/evidence`, R2.cookie), P(caseId))).status === 404);

    console.log('\nThe resident sees their own');
    const mine = await json(await residentEvidenceGET(req(`/api/resident/cases/${caseId}/evidence`, R.cookie), P(caseId)));
    ok('their photos, marked as theirs', mine.status === 200 && mine.body.data.items.length === 3 && mine.body.data.items.every((i: Body) => i.uploadedBy === 'You'));
    ok('...and can open one', (await imageGET(req(`/api/attachments/${first.id}`, R.cookie), P(first.id))).status === 200);
    // An official's internal note with a photo, and a hearing record's photo: never the resident's.
    const internal = await prisma.caseFollowUp.create({ data: { caseId, userId: B.id, authorRole: 'officer', content: 'Internal note', visibleToReporter: false } });
    const internalAtt = await prisma.caseAttachment.create({ data: { caseId, followUpId: internal.id, filename: 'internal.jpg', mimeType: 'image/jpeg', size: D.length, data: new Uint8Array(D), uploadedByUserId: B.id } });
    const shared = await prisma.caseFollowUp.create({ data: { caseId, userId: B.id, authorRole: 'officer', content: 'Shared update', visibleToReporter: true } });
    const sharedAtt = await prisma.caseAttachment.create({ data: { caseId, followUpId: shared.id, filename: 'shared.jpg', mimeType: 'image/jpeg', size: C.length, data: new Uint8Array(C), uploadedByUserId: B.id } });
    const mine2 = (await json(await residentEvidenceGET(req(`/api/resident/cases/${caseId}/evidence`, R.cookie), P(caseId)))).body.data.items as Body[];
    ok('an official\'s internal follow-up photo is not in the resident\'s list, and cannot be opened by id', !mine2.some(i => i.id === internalAtt.id)
      && (await imageGET(req(`/api/attachments/${internalAtt.id}`, R.cookie), P(internalAtt.id))).status === 403);
    ok('a photo on an update shared with them is, marked as from the barangay', mine2.some(i => i.id === sharedAtt.id && i.uploadedBy === 'The barangay'));
    const staff2 = (await json(await staffEvidenceGET(req(`/api/cases/${caseId}/evidence`, B.cookie), P(caseId)))).body.data.items as Body[];
    ok('officials see both, with the official named', staff2.some(i => i.id === internalAtt.id && i.uploadedBy === 'Probe blotter (official)') && staff2.some(i => i.id === sharedAtt.id));

    console.log('\nFollow-up photos');
    const badFu = await json(await residentFollowUpPOST(req(`/api/resident/cases/${caseId}/follow-ups`, R.cookie, 'POST', { progress: 'still_happening', note: 'Nangyari ulit', photo: { name: 'clip.gif', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } }), P(caseId)));
    ok('a follow-up with a photo that cannot be stored is refused with the reason - not saved without it', badFu.status === 400 && /clip\.gif/.test(badFu.body.error ?? '')
      && (await prisma.caseFollowUp.count({ where: { caseId, authorRole: 'resident' } })) === 0, `${badFu.status} ${badFu.body.error}`);
    const goodFu = await json(await residentFollowUpPOST(req(`/api/resident/cases/${caseId}/follow-ups`, R.cookie, 'POST', { progress: 'still_happening', note: 'Nangyari ulit kagabi', photo: { name: 'again.jpg', dataUrl: dataUrl(D) } }), P(caseId)));
    const fuAtt = await prisma.caseAttachment.findFirst({ where: { caseId, followUp: { authorRole: 'resident' } } });
    ok('a good follow-up photo is stored with its uploader and fingerprint, and listed for both sides', goodFu.status === 201 && fuAtt?.uploadedByResidentId === R.id && fuAtt.sha256 === sha(D)
      && ((await json(await staffEvidenceGET(req(`/api/cases/${caseId}/evidence`, B.cookie), P(caseId)))).body.data.items as Body[]).some(i => i.id === fuAtt.id && i.source === 'follow_up'), `${goodFu.status} ${goodFu.body.error ?? ''}`);

    console.log('\nHearing records and anonymous reports');
    const anon = await file(R.cookie, { reportingRelationship: 'ANONYMOUS', submissionKey: `${TAG}-anon-${process.pid}`, attachments: [{ name: 'anon.jpg', dataUrl: dataUrl(C) }] });
    const anonList = (await json(await staffEvidenceGET(req(`/api/cases/${anon.body.data.id}/evidence`, B.cookie), P(anon.body.data.id)))).body.data.items as Body[];
    ok('an anonymous report\'s photo: officials see it, credited only to "The reporter"', anon.status === 201 && anonList.length === 1 && anonList[0].uploadedBy === 'The reporter'
      && !JSON.stringify(anonList).includes('Evidencia'));

    console.log('\n10. Evidence stored before this fix');
    const legacy = await prisma.caseAttachment.create({ data: { caseId: one.body.data.id, filename: 'old-photo.jpg', mimeType: 'image/jpeg', size: Bp.length, data: new Uint8Array(Bp) } });
    ok('a photo with no fingerprint or uploader recorded is still listed and served', ((await json(await staffEvidenceGET(req(`/api/cases/${one.body.data.id}/evidence`, B.cookie), P(one.body.data.id)))).body.data.items as Body[]).some(i => i.id === legacy.id)
      && (await imageGET(req(`/api/attachments/${legacy.id}`, B.cookie), P(legacy.id))).status === 200 && (await imageGET(req(`/api/attachments/${legacy.id}`, R.cookie), P(legacy.id))).status === 200);
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { OR: [{ id: { in: caseIds } }, { residentId: { in: residents } }] } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  const left = { cases: await prisma.case.count({ where: { OR: [{ id: { in: caseIds } }, { residentId: { in: residents } }] } }), photos: await prisma.caseAttachment.count({ where: { caseId: { in: caseIds } } }),
    residents: await prisma.resident.count({ where: { id: { in: residents } } }), users: await prisma.user.count({ where: { email: { startsWith: 'probe.evt.' } } }) };
  ok('every test row removed', Object.values(left).every(n => n === 0), JSON.stringify(left));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
