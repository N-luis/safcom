/**
 * Notifications about officials' follow-up entries, end to end through the
 * real API routes and the real database (in-process; no dev server needed).
 * Run with:  npm run test:notifications
 *
 * Temporary residents, officials and cases are marked PROBE-NT and removed at
 * the end. No real resident's data is read or logged.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { residentNotice } from '../lib/notifications';
import { sanitizeNote } from '../lib/followUps';
import { POST as followUpPOST } from '../app/api/cases/[id]/follow-ups/route';
import { PATCH as followUpPATCH, DELETE as followUpDELETE } from '../app/api/cases/[id]/follow-ups/[fid]/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { GET as notifGET } from '../app/api/notifications/route';
import { PATCH as notifPATCH, DELETE as notifDELETE } from '../app/api/notifications/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-NT';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// Response bodies are read loosely here; the assertions say what each must hold.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  : { status: 0, body: {} as Body };

// Messages of every shape the list and the dialog have to hold.
const SHORT = 'Na-schedule na ang mediation sa Lunes, 9:00 AM.';
const LONG = 'Kinausap na namin ang magkabilang panig at nagkasundo silang humarap sa Lupon sa susunod na linggo. '
  + 'Please bring any documents you have, such as receipts or photos, so the Lupon can review them before the hearing. '
  + 'Kung hindi kayo makakadalo, pakisabi lang sa barangay hall para ma-reschedule.';
const VERY_LONG = ('Update ng imbestigasyon: kinausap ang mga saksi at kinuha ang kanilang salaysay. '
  + 'The patrol log for the night of the incident was checked and matches the time you gave. ').repeat(5).trim();
const BREAKS = 'Mga susunod na hakbang:\n1. Mediation sa Lunes\n2. Dalhin ang resibo\n\nSalamat po.';
const URL_TEXT = 'Basahin ang gabay dito: https://example.gov.ph/barangay/lupon/katarungang-pambarangay/mga-hakbang-sa-pag-aayos-ng-alitan?ref=safecomm-notification-test-very-long-parameter-value and a long word: Pneumonoultramicroscopicsilicovolcanoconiosis';
const SECRET = 'INTERNAL-ONLY witness Juan said the respondent keeps a bolo at home';

async function main() {
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  try {
    // ── The rule itself, without the database ──
    console.log('\nWhat a resident is told about each kind of activity');
    const fu = (o: Partial<Parameters<typeof residentNotice>[1] & object>) => ({
      type: 'note', content: 'x', statusFrom: null, statusTo: null, visibleToReporter: true, hiddenAt: null, ...o,
    });
    ok('a shared entry is told whole, from the entry', residentNotice({ type: 'follow_up', message: 'Note added by X: cut…' }, fu({ content: VERY_LONG }))?.message === VERY_LONG);
    ok('an internal entry is not told', residentNotice({ type: 'follow_up', message: 'm' }, fu({ visibleToReporter: false })) === null);
    ok('a hidden entry is not told', residentNotice({ type: 'follow_up', message: 'm' }, fu({ hiddenAt: new Date() })) === null);
    const st = residentNotice({ type: 'follow_up', message: 'm' }, fu({ visibleToReporter: false, content: SECRET, statusFrom: 'Open', statusTo: 'Under Investigation' }));
    ok('an internal status change tells the status, not the note', st?.message === 'Status updated - Open → Under Investigation' && !st.message.includes('INTERNAL'));
    ok('a legacy unlinked note is not told', residentNotice({ type: 'follow_up', message: `Note added by Officer: ${SECRET.slice(0, 80)}…` }, undefined) === null);
    ok('a legacy unlinked status change tells only the status',
      residentNotice({ type: 'follow_up', message: 'Status update by Officer Reyes — Status: Open → Resolved' }, undefined)?.message === 'Status updated - Open → Resolved');
    ok('intake activity is never told', residentNotice({ type: 'intake', message: 'Immediate danger disclosed during intake' }, undefined) === null);
    ok('assignment is told without the officer\'s name', residentNotice({ type: 'assignment', message: 'Case X assigned to Officer Reyes' }, undefined)?.message.includes('Reyes') === false);
    ok('unassignment is not told', residentNotice({ type: 'assignment', message: 'Case X unassigned' }, undefined) === null);
    ok('filing is told without triage detail', !/triage|rule|HIGH-RISK/.test(residentNotice({ type: 'case_filed', message: 'Resident filed case X: DV — High risk, triage urgent review (rule H1) ⚠ HIGH-RISK ZONE' }, undefined)?.message ?? 'triage'));
    ok('sanitizeNote keeps paragraph breaks, also from Windows text', sanitizeNote('Una\r\n\r\n\r\nIkalawa') === 'Una\n\nIkalawa' && sanitizeNote(BREAKS) === BREAKS);

    // ── People and cases ──
    const mkRes = async (k: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: `Probe${k}`, lastName: 'Notiftest',
        age: 30, gender: 'Female', barangay: 'Ayukit', address: `${k} Test Street`, emailVerified: true } });
      residents.push(r.id); return r;
    };
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.nt.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const owner = await mkRes('Owner');
    const other = await mkRes('Other');
    const B = await mkUser('blotter', 'officer');
    const V = await mkUser('vawc', 'vawc_officer');
    const resCookie = (id: string) => `resident_token=${signResidentToken({ residentId: id, email: 'x', name: 'Probe', role: 'resident' })}`;
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'ProbeOwner Notiftest', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'temporary test case narrative', status: 'Open', riskLevel: null, municipality: 'Bocaue', province: 'Bulacan',
        residentId: owner.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const blotterCase = await mkCase({ assignedToId: B.id });
    const vawcCase = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });

    const post = (caseId: string, cookie: string, body: Body) =>
      followUpPOST(req(`/api/cases/${caseId}/follow-ups`, cookie, 'POST', body), { params: Promise.resolve({ id: caseId }) }).then(json);
    const feed = async (cookie: string) => (await json(await updatesGET(req('/api/resident/updates?limit=20', cookie)))).body.data as Body[] ?? [];

    // ── An official adds entries ──
    console.log('\nAn official adds follow-up entries');
    const made: Record<string, string> = {};
    for (const [k, type, content] of [
      ['short', 'note', SHORT], ['long', 'investigation', LONG], ['veryLong', 'investigation', VERY_LONG],
      ['breaks', 'intervention', BREAKS], ['url', 'evidence', URL_TEXT],
    ] as const) {
      const r = await post(blotterCase.id, B.cookie, { type, content, visibleToReporter: true });
      ok(`${k}: saved (201)`, r.status === 201, String(r.status));
      made[k] = r.body.data?.id;
    }
    const internal = await post(blotterCase.id, B.cookie, { type: 'note', content: SECRET });
    ok('an entry is internal unless shared', internal.status === 201 && internal.body.data?.visibleToReporter === false);
    const internalStatus = await post(blotterCase.id, B.cookie, { type: 'status_change', content: `${SECRET} (status)`, statusTo: 'Under Investigation' });
    ok('an internal status change saved', internalStatus.status === 201);
    const vawcShared = await post(vawcCase.id, V.cookie, { type: 'intervention', content: 'Na-refer na kayo sa MSWDO para sa counseling. Tatawagan kayo bago ang appointment.', visibleToReporter: true });
    ok('the VAWC desk adds a shared entry on its case', vawcShared.status === 201);
    const blocked = await post(vawcCase.id, B.cookie, { type: 'note', content: 'should not save', visibleToReporter: true });
    ok('a blotter officer cannot add to a VAWC case', blocked.status === 404, String(blocked.status));

    // ── Stored whole, and once ──
    console.log('\nStored whole, and one notice per entry');
    const stored = await prisma.caseFollowUp.findMany({ where: { id: { in: Object.values(made) } } });
    ok('every entry is stored in full, not cut', stored.length === 5 && stored.every(s =>
      [SHORT, LONG, VERY_LONG, BREAKS, URL_TEXT].includes(s.content)), stored.map(s => s.content.length).join(','));
    const acts = await prisma.activity.findMany({ where: { caseId: blotterCase.id, type: 'follow_up' } });
    ok('exactly one activity per saved entry', acts.length === 7, String(acts.length));
    ok('each activity is linked to its entry', acts.every(a => a.entityType === 'CaseFollowUp') && new Set(acts.map(a => a.entityId)).size === 7);

    // Rows the desk writes that a resident must never see, written as the routes write them.
    await prisma.activity.createMany({ data: [
      { type: 'intake', message: `Intake started (draft) by ${TAG} vawc`, caseId: vawcCase.id, entityType: 'OfficialIntake', color: '#0ea5e9' },
      { type: 'intake', message: `Immediate danger disclosed during intake - flagged for urgent review by ${TAG} vawc`, caseId: vawcCase.id, entityType: 'OfficialIntake', color: '#dc2626' },
      { type: 'assignment', message: `Case ${blotterCase.caseNumber} assigned to ${TAG} blotter`, caseId: blotterCase.id, entityType: 'Case', entityId: blotterCase.id },
      { type: 'case_filed', message: `Resident filed case ${blotterCase.caseNumber}: Noise Complaint — risk undetermined, triage needs follow up, information insufficient (rule H2) ⚠ HIGH-RISK ZONE`, caseId: blotterCase.id, entityType: 'Case', entityId: blotterCase.id },
      { type: 'follow_up', message: `Note added by ${TAG} blotter: LEGACY ${SECRET}`.slice(0, 120), caseId: blotterCase.id, entityType: 'Case', entityId: blotterCase.id },
    ] });

    // ── The resident's notifications ──
    console.log('\nThe resident\'s notifications');
    const mine = await feed(resCookie(owner.id));
    const onCase = (id: string) => mine.filter(u => u.caseId === id);
    const byMsg = (m: string) => mine.find(u => u.message === m);
    for (const [k, m] of [['short', SHORT], ['long', LONG], ['very long', VERY_LONG], ['line breaks', BREAKS], ['URL / long word', URL_TEXT]] as const) {
      ok(`${k}: the notice carries the complete message`, Boolean(byMsg(m)), `${m.length} chars`);
    }
    ok('the very long message is not cut (no trailing …)', byMsg(VERY_LONG)?.message.length === VERY_LONG.length);
    ok('line breaks survive to the notice', byMsg(BREAKS)?.message.includes('\n1. Mediation') === true);
    ok('a notice says what kind of entry it is', byMsg(LONG)?.entryLabel === 'Investigation update' && byMsg(URL_TEXT)?.entryLabel === 'Evidence update');
    ok('a notice carries its case for "View case"', byMsg(SHORT)?.caseId === blotterCase.id && byMsg(SHORT)?.caseNumber === blotterCase.caseNumber);
    const text = JSON.stringify(mine);
    ok('no internal note reaches the resident', !text.includes('INTERNAL-ONLY') && !text.includes('LEGACY'));
    ok('the internal status change is told as a status only', onCase(blotterCase.id).some(u => u.message === 'Status updated - Open → Under Investigation'));
    ok('no officer is named', !text.includes(`${TAG} blotter`) && !text.includes(`${TAG} vawc`));
    ok('no intake or danger-flag line reaches the resident', !/Intake started|Immediate danger/.test(text));
    ok('no triage detail reaches the resident', !/triage|rule H|HIGH-RISK/.test(text));
    ok('assignment is told plainly', onCase(blotterCase.id).some(u => u.message === 'A barangay officer has been assigned to your case.'));
    ok('the VAWC desk\'s shared entry reaches the reporter in full', onCase(vawcCase.id).some(u => u.message.startsWith('Na-refer na kayo sa MSWDO') && u.message.endsWith('appointment.')));

    // ── Another resident ──
    console.log('\nAnother resident');
    const theirs = await feed(resCookie(other.id));
    ok('sees none of these notices', !theirs.some(u => caseIds.includes(u.caseId)) && !JSON.stringify(theirs).includes('Na-schedule'));

    // ── Changes after the fact ──
    console.log('\nAfter an edit, a hide, and a refresh');
    const editTo = `${SHORT} (Binago: 10:00 AM na.)`;
    const ed = await json(await followUpPATCH(req(`/api/cases/${blotterCase.id}/follow-ups/${made.short}`, B.cookie, 'PATCH', { content: editTo }),
      { params: Promise.resolve({ id: blotterCase.id, fid: made.short }) }));
    ok('the official edits the entry', ed.status === 200);
    const hid = await json(await followUpDELETE(req(`/api/cases/${blotterCase.id}/follow-ups/${made.long}?reason=${encodeURIComponent('posted on the wrong case')}`, B.cookie, 'DELETE'),
      { params: Promise.resolve({ id: blotterCase.id, fid: made.long }) }));
    ok('the official hides another', hid.status === 200);
    const again = await feed(resCookie(owner.id));
    ok('the notice shows the edited text, not a stale copy', again.some(u => u.message === editTo) && !again.some(u => u.message === SHORT));
    ok('a hidden entry\'s notice is gone', !again.some(u => u.message === LONG));
    ok('the complete message is still there on a fresh read', again.some(u => u.message === VERY_LONG));

    // ── Staff notifications, by id ──
    console.log('\nStaff notifications, by id');
    const vawcNotice = await prisma.notification.create({ data: { title: `${TAG} VAWC notice`, message: 'about a VAWC case', type: 'warning', userId: null, caseId: vawcCase.id } });
    const vOwn = await prisma.notification.create({ data: { title: `${TAG} for V only`, message: 'personal', type: 'info', userId: V.id } });
    const nparams = (id: string) => ({ params: Promise.resolve({ id }) });
    const bList = await json(await notifGET(req('/api/notifications?limit=100', B.cookie)));
    ok('the blotter list leaves out the VAWC case notice', !(bList.body.data?.notifications as Body[]).some(x => x.id === vawcNotice.id));
    ok('a blotter officer cannot mark the VAWC notice read by id', (await notifPATCH(req(`/api/notifications/${vawcNotice.id}`, B.cookie, 'PATCH'), nparams(vawcNotice.id)))?.status === 404);
    ok('or delete it', (await notifDELETE(req(`/api/notifications/${vawcNotice.id}`, B.cookie, 'DELETE'), nparams(vawcNotice.id)))?.status === 404);
    ok('nor delete another officer\'s own notice', (await notifDELETE(req(`/api/notifications/${vOwn.id}`, B.cookie, 'DELETE'), nparams(vOwn.id)))?.status === 404);
    ok('both are still there', await prisma.notification.count({ where: { id: { in: [vawcNotice.id, vOwn.id] } } }) === 2);
    ok('the VAWC officer can mark the VAWC notice read', (await notifPATCH(req(`/api/notifications/${vawcNotice.id}`, V.cookie, 'PATCH'), nparams(vawcNotice.id)))?.status === 200);
    ok('and their own notice', (await notifPATCH(req(`/api/notifications/${vOwn.id}`, V.cookie, 'PATCH'), nparams(vOwn.id)))?.status === 200);
  } finally {
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }, { title: { startsWith: TAG } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.nt.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
