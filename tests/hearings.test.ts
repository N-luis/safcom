/**
 * Hearing Management (Hearings 1-3), through the real routes and the real
 * database (in-process; no dev server needed).
 * Run with:  npm run test:hearings
 *
 * Temporary rows are marked PROBE-HM and removed at the end; counts that the
 * real data also feeds are read before and checked by how much they changed.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import {
  hearingEligibility, hearingRefusal, nextHearingNumber, statusFromNotices, residentHearingMessage, phDay, KP_KEYS,
} from '../lib/hearings';
import { decideHearingAccess } from '../lib/hearingsServer';
import { GET as caseHearingsGET, POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { PATCH as hearingPATCH } from '../app/api/cases/[id]/hearings/[hid]/route';
import { GET as noticePreview, POST as noticePOST } from '../app/api/cases/[id]/hearings/[hid]/notices/route';
import { PATCH as noticePATCH } from '../app/api/cases/[id]/hearings/[hid]/notices/[nid]/route';
import { GET as noticePDF } from '../app/api/cases/[id]/hearings/[hid]/notices/[nid]/pdf/route';
import { POST as attachPOST } from '../app/api/cases/[id]/hearings/[hid]/attachments/route';
import { POST as kpPOST } from '../app/api/cases/[id]/kp-review/route';
import { GET as listGET } from '../app/api/hearings/route';
import { GET as candidatesGET } from '../app/api/hearings/cases/route';
import { GET as residentGET } from '../app/api/resident/hearings/route';
import { POST as residentPOST } from '../app/api/resident/hearings/[hid]/route';
import { GET as residentNotice } from '../app/api/resident/hearings/[hid]/notice/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { GET as attachmentGET } from '../app/api/attachments/[id]/route';
import { GET as analyticsGET } from '../app/api/analytics/[section]/route';
import { GET as cronGET } from '../app/api/cron/hearing-reminders/route';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-HM';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  : { status: 0, body: {} as Body };
async function pdfText(res: Response | undefined) {
  const bytes = new Uint8Array(await res!.arrayBuffer());
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ');
  return out;
}
const allChecks = Object.fromEntries(KP_KEYS.map(k => [k, true]));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const savedSecret = process.env.CRON_SECRET;
  try {
    // ── The rules on their own ──
    console.log('\nRules');
    const verified = { caseType: 'Noise Complaint', at: new Date() };
    const review = { decision: 'ELIGIBLE', caseType: 'Noise Complaint', at: new Date() };
    ok('a VAWC case is never eligible, whatever was reviewed', !hearingEligibility({ caseType: 'Domestic Violence', status: 'Open', verifiedCategory: { caseType: 'Domestic Violence', at: new Date() }, review: { ...review, caseType: 'Domestic Violence' } }).eligible);
    ok('an unverified category is not eligible', hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: null, review }).reasons.some(r => /category/i.test(r)));
    ok('a review made under another category must be redone', hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review: { ...review, caseType: 'Vandalism' } }).needsReview);
    ok('reviewed as not eligible stays not eligible', !hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review: { ...review, decision: 'NOT_ELIGIBLE' } }).eligible);
    ok('verified and reviewed is eligible', hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review }).eligible);
    ok('a closed case is not', !hearingEligibility({ caseType: 'Noise Complaint', status: 'Closed', verifiedCategory: verified, review }).eligible);
    ok('filed on the VAWC form or read as VAWC by the AI: a warning', hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review, reportPath: 'VAWC', aiSuggestedCategory: 'Domestic Violence' }).warnings.length === 2);
    ok('hearing 2 waits for hearing 1 to be held', hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'NOTICE_ISSUED' }], 2) !== null);
    ok('a settlement ends the proceedings', hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'COMPLETED', outcome: 'SETTLED' }], 2)?.includes('ended') === true);
    ok('a continued hearing allows the next', hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'COMPLETED', outcome: 'CONTINUED' }], 2) === null);
    ok('a cancelled hearing may be replaced', hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'CANCELLED' }], 1) === null);
    ok('no hearing after three', nextHearingNumber([1, 2, 3].map(n => ({ hearingNumber: n, status: 'COMPLETED' }))) === null);
    ok('a generated notice changes nothing; an issued one does', statusFromNotices({ status: 'SCHEDULED', rescheduleCount: 0 }, [{ status: 'GENERATED' }]) === 'SCHEDULED'
      && statusFromNotices({ status: 'SCHEDULED', rescheduleCount: 0 }, [{ status: 'ISSUED' }]) === 'NOTICE_ISSUED'
      && statusFromNotices({ status: 'NOTICE_ISSUED', rescheduleCount: 0 }, [{ status: 'ACKNOWLEDGED' }, { status: 'ACKNOWLEDGED' }]) === 'ACKNOWLEDGED');
    ok('the complainant is not told of notes, attendance, the respondent\'s notice or a cancelled draft',
      residentHearingMessage({ kind: 'proceedings_note', after: { hearingNumber: 1 } }) === null
      && residentHearingMessage({ kind: 'attendance', after: { hearingNumber: 1 } }) === null
      && residentHearingMessage({ kind: 'notice_issued', after: { hearingNumber: 1, recipientRole: 'RESPONDENT' } }) === null
      && residentHearingMessage({ kind: 'cancelled', after: { hearingNumber: 1, wasDraft: true } }) === null);
    const actor = (role: string, id = 'u1') => ({ id, role, active: true });
    ok('access: assigned blotter officer and captain run hearings; system admin views only', decideHearingAccess(actor('officer'), { caseType: 'Noise Complaint', assignedToId: 'u1' }).edit
      && decideHearingAccess(actor('admin'), { caseType: 'Noise Complaint', assignedToId: 'x' }).edit
      && decideHearingAccess(actor('system_admin'), { caseType: 'Noise Complaint', assignedToId: 'x' }).view
      && !decideHearingAccess(actor('system_admin'), { caseType: 'Noise Complaint', assignedToId: 'x' }).edit);
    ok('access: another blotter officer may not, unless presiding', !decideHearingAccess(actor('officer'), { caseType: 'Noise Complaint', assignedToId: 'x' }).view
      && decideHearingAccess(actor('officer'), { caseType: 'Noise Complaint', assignedToId: 'x' }, true).edit);
    ok('access: the VAWC desk runs no ordinary hearings; a VAWC case is hidden from the blotter desk',
      !decideHearingAccess(actor('vawc_officer'), { caseType: 'Noise Complaint', assignedToId: 'u1' }).view
      && !decideHearingAccess(actor('vawc_officer'), { caseType: 'Domestic Violence', assignedToId: 'u1' }).edit
      && decideHearingAccess(actor('officer'), { caseType: 'Domestic Violence', assignedToId: 'u1' }).hidden);

    // ── People and cases ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.hm.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const B2 = await mk('blotter2', 'officer');
    const C = await mk('captain', 'admin');
    const S = await mk('sysadmin', 'system_admin');
    const V = await mk('vawc', 'vawc_officer');
    const mkRes = async (k: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: 'Maria', lastName: `Complainant${k}`, age: 34, gender: 'Female', barangay: 'Ayukit', address: 'temporary', emailVerified: true } });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Maria', role: 'resident' })}` };
    };
    const R1 = await mkRes('a');
    const R2 = await mkRes('b');
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Maria Complainanta', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'temporary test case', status: 'Open', riskLevel: 'Low', residentId: R1.id, assignedToId: B.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const K = await mkCase({});
    const respondent = await prisma.caseParty.create({ data: { caseId: K.id, role: 'REPORTED', fullName: 'Juan Respondent', address: '7 Secret Lane', source: 'reporter' } });
    const KV = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });
    const K2 = await mkCase({});
    await prisma.assessmentHistory.create({ data: { caseId: K2.id, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
    await prisma.caseKpReview.create({ data: { caseId: K2.id, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: allChecks, reviewedById: B.id } });

    const P = (id: string) => ({ params: Promise.resolve({ id }) });
    const PH = (id: string, hid: string) => ({ params: Promise.resolve({ id, hid }) });
    const PN = (id: string, hid: string, nid: string) => ({ params: Promise.resolve({ id, hid, nid }) });
    const create = (caseId: string, cookie: string, body: Body) => caseHearingsPOST(req(`/api/cases/${caseId}/hearings`, cookie, 'POST', body), P(caseId)).then(json);
    const patch = (caseId: string, hid: string, cookie: string, body: Body) => hearingPATCH(req(`/api/cases/${caseId}/hearings/${hid}`, cookie, 'PATCH', body), PH(caseId, hid)).then(json);
    const detail = async (caseId: string, cookie = B.cookie) => (await json(await caseHearingsGET(req(`/api/cases/${caseId}/hearings`, cookie), P(caseId)))).body.data;
    const resident = async (cookie = R1.cookie) => (await json(await residentGET(req('/api/resident/hearings', cookie)))).body.data;
    const rpost = (hid: string, body: Body, cookie = R1.cookie) => residentPOST(req(`/api/resident/hearings/${hid}`, cookie, 'POST', body), { params: Promise.resolve({ hid }) }).then(json);
    const feed = async () => ((await json(await updatesGET(req('/api/resident/updates?limit=20', R1.cookie)))).body.data ?? []) as Body[];
    const getA = (section: string, cookie: string, q = '') => analyticsGET(req(`/api/analytics/${section}?${q}`, cookie), { params: Promise.resolve({ section }) }).then(json);
    const before = (await getA('hearings', C.cookie, 'scope=blotter')).body.data;
    const today = phDay(new Date());
    const future = new Date(Date.now() + 5 * 86_400_000);
    const futureDay = phDay(future);

    // ── 14. VAWC protection ──
    console.log('\nVAWC cases stay out of ordinary hearings');
    const vv = await create(KV.id, V.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' });
    ok('the VAWC officer cannot create a hearing on a VAWC case', vv.status === 422 && /RA 9262/.test(vv.body.error ?? ''), `${vv.status}`);
    ok('nor can the captain', (await create(KV.id, C.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' })).status === 422);
    ok('no eligibility review can be recorded on it', (await json(await kpPOST(req(`/api/cases/${KV.id}/kp-review`, C.cookie, 'POST', { checklist: allChecks }), P(KV.id)))).status === 422);
    ok('to the blotter desk the VAWC case is not found', (await json(await caseHearingsGET(req(`/api/cases/${KV.id}/hearings`, B.cookie), P(KV.id)))).status === 404);
    const vlist = await json(await listGET(req('/api/hearings', V.cookie)));
    ok('Hearing Management refuses the VAWC desk, with the reason', vlist.status === 403 && /RA 9262/.test(vlist.body.error ?? ''));
    const cand = (await json(await candidatesGET(req(`/api/hearings/cases?q=${KV.caseNumber}`, C.cookie)))).body.data as Body[];
    ok('a VAWC case looked up by number is shown with why it cannot have a hearing', cand.some(c => c.id === KV.id && !c.eligible && /RA 9262/.test(c.reasons[0])));
    ok('it is never offered among the eligible cases', !cand.some(c => c.id === KV.id && c.eligible));

    // ── Eligibility before Hearing 1 ──
    console.log('\nEligibility');
    const e1 = await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' });
    ok('without a verified category: refused, and why', e1.status === 422 && /category/i.test(e1.body.error ?? ''));
    await prisma.assessmentHistory.create({ data: { caseId: K.id, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
    const e2 = await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' });
    ok('without the eligibility review: refused', e2.status === 422 && /review/i.test(e2.body.error ?? ''));
    const kp = (cookie: string, body: Body) => kpPOST(req(`/api/cases/${K.id}/kp-review`, cookie, 'POST', body), P(K.id)).then(json);
    ok('a review with a point unticked needs a reason', (await kp(B.cookie, { checklist: { ...allChecks, offence_limit: false } })).status === 400);
    const ne = await kp(B.cookie, { checklist: { ...allChecks, offence_limit: false }, note: 'Penalty exceeds one year' });
    ok('...and is recorded as not eligible', ne.status === 201 && ne.body.data.review.decision === 'NOT_ELIGIBLE' && !ne.body.data.eligibility.eligible);
    ok('a hearing is then refused', (await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' })).status === 422);
    ok('the system administrator cannot record a review', (await kp(S.cookie, { checklist: allChecks })).status === 403);
    const el = await kp(B.cookie, { checklist: allChecks });
    ok('a full review makes the case eligible', el.status === 201 && el.body.data.eligibility.eligible === true);

    // ── 13. Role permissions ──
    console.log('\nWho may create');
    ok('another blotter officer may not', (await create(K.id, B2.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' })).status === 403);
    ok('the system administrator may not', (await create(K.id, S.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' })).status === 403);
    ok('a resident session is not an official', (await create(K.id, R1.cookie, { hearingNumber: 1, date: futureDay, time: '09:00' })).status === 401);
    ok('the system administrator may view', (await json(await caseHearingsGET(req(`/api/cases/${K.id}/hearings`, S.cookie), P(K.id)))).status === 200);
    ok('no date in the past', (await create(K.id, B.cookie, { hearingNumber: 1, date: '2020-01-01', time: '09:00' })).status === 400);
    ok('the respondent must be a person recorded on this case', (await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '09:00', respondentPartyId: 'not-a-party' })).status === 400);

    // ── 1. Hearing 1 ──
    console.log('\nHearing 1 - Initial Hearing');
    const h1r = await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '09:30', venue: 'Barangay Hall, session room', assignedOfficialId: C.id,
      respondentPartyId: respondent.id, notes: 'Internal: both families are neighbours', residentInstructions: 'Bring the photos of the speaker', asDraft: true });
    ok('Hearing 1 is created as a draft', h1r.status === 201 && h1r.body.data.status === 'DRAFT' && h1r.body.data.reference === `HRG-${K.caseNumber}-H1`, `${h1r.status} ${h1r.body.error ?? ''}`);
    const H1 = h1r.body.data.id as string;
    ok('the date and time are kept as Philippine time', phDay(h1r.body.data.scheduledAt) === futureDay && new Date(h1r.body.data.scheduledAt).toISOString().slice(11, 16) === '01:30');
    ok('a draft is not shown to the complainant', !(await resident()).history.some((g: Body) => g.case.id === K.id));
    ok('the presiding official is told', await prisma.notification.count({ where: { caseId: K.id, userId: C.id, title: { contains: 'assigned to Hearing 1' } } }) === 1);
    ok('a second hearing 1 cannot be created while it is open', (await create(K.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '10:00' })).status === 422);
    ok('the draft can be edited', (await patch(K.id, H1, B.cookie, { action: 'update', venue: 'Barangay Hall' })).status === 200);
    ok('the presiding official (captain) may act on it', (await patch(K.id, H1, C.cookie, { action: 'update', residentInstructions: 'Bring the photos of the speaker and a valid ID' })).status === 200);
    const sch = await patch(K.id, H1, B.cookie, { action: 'schedule' });
    ok('scheduling it tells the complainant', sch.status === 200 && (await feed()).some(f => /Hearing 1 is scheduled for/.test(f.message)));
    const r1 = await resident();
    const up = r1.upcoming.find((h: Body) => h.id === H1);
    ok('the complainant sees date, time, venue, status and instructions', up && up.venue === 'Barangay Hall' && up.statusLabel === 'Scheduled'
      && up.instructions.some((i: string) => i.includes('valid ID')));
    const residentJson = JSON.stringify(r1);
    ok('...and nothing the officials keep: no internal note, respondent, address or official', !/Internal: both families|Juan Respondent|7 Secret Lane|PROBE-HM captain|PROBE-HM blotter/.test(residentJson));
    ok('the complainant\'s feed names no official', !(await feed()).some(f => /PROBE-HM/.test(f.message)));

    // ── 4. Notices ──
    console.log('\nNotices');
    const preview = await noticePreview(req(`/api/cases/${K.id}/hearings/${H1}/notices?recipient=COMPLAINANT`, B.cookie), PH(K.id, H1));
    const pv = await pdfText(preview);
    ok('a preview is a printable notice, marked as not issued, and stores nothing', preview!.status === 200 && pv.includes('NOTICE OF HEARING') && pv.includes('PREVIEW')
      && await prisma.caseHearingNotice.count({ where: { hearingId: H1 } }) === 0);
    const gen = (recipient: string) => noticePOST(req(`/api/cases/${K.id}/hearings/${H1}/notices`, B.cookie, 'POST', { recipient }), PH(K.id, H1)).then(json);
    const nc = await gen('COMPLAINANT');
    ok('generating gives it a number - and it is not issued or delivered', nc.status === 201 && nc.body.data.noticeNumber === `HN-${K.caseNumber}-H1-C1` && nc.body.data.status === 'GENERATED');
    ok('generating does not change the hearing\'s status', (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'SCHEDULED');
    ok('a second notice to the same party for the same date is refused', (await gen('COMPLAINANT')).status === 409);
    ok('the complainant cannot open a notice that is not issued', (await residentNotice(req(`/api/resident/hearings/${H1}/notice`, R1.cookie), { params: Promise.resolve({ hid: H1 }) }))!.status === 404);
    const np = (nid: string, body: Body, cookie = B.cookie) => noticePATCH(req(`/api/cases/${K.id}/hearings/${H1}/notices/${nid}`, cookie, 'PATCH', body), PN(K.id, H1, nid)).then(json);
    ok('issued through SafeComm', (await np(nc.body.data.id, { action: 'issue', method: 'SAFECOMM' })).status === 200);
    ok('the hearing is now "notice issued"', (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'NOTICE_ISSUED');
    ok('the complainant is told', (await feed()).some(f => /Your notice for Hearing 1 has been issued/.test(f.message)));
    const nr = await gen('RESPONDENT');
    ok('the respondent\'s notice cannot go through SafeComm', (await np(nr.body.data.id, { action: 'issue', method: 'SAFECOMM' })).status === 400);
    ok('the respondent\'s notice is served and recorded as not delivered', (await np(nr.body.data.id, { action: 'issue', method: 'SERVED' })).status === 200
      && (await np(nr.body.data.id, { action: 'delivery', delivered: false, note: 'Nobody home' })).status === 200);
    const rn = await residentNotice(req(`/api/resident/hearings/${H1}/notice`, R1.cookie), { params: Promise.resolve({ hid: H1 }) });
    const rt = await pdfText(rn);
    ok('the complainant downloads their notice: case, hearing, date, venue, recipient', rn!.status === 200 && rt.includes(K.caseNumber) && rt.includes('Hearing 1')
      && rt.includes('Barangay Hall') && rt.includes('Maria Complainanta') && !rt.includes('PREVIEW'));
    ok('their notice says nothing about the other party', !/Juan Respondent|Secret Lane/.test(rt));
    const offPdf = await pdfText(await noticePDF(req(`/api/cases/${K.id}/hearings/${H1}/notices/${nr.body.data.id}/pdf`, B.cookie), PN(K.id, H1, nr.body.data.id)));
    ok('the respondent\'s notice is addressed to the respondent and names the issuing officer', offPdf.includes('Juan Respondent') && offPdf.includes('PROBE-HM blotter'));

    // ── 5, 6. The complainant acknowledges and replies ──
    console.log('\nThe complainant');
    const a1 = await rpost(H1, { action: 'acknowledge' });
    ok('acknowledges the notice', a1.status === 200 && (await prisma.caseHearingNotice.findUnique({ where: { id: nc.body.data.id } }))?.acknowledgedVia === 'RESIDENT_APP');
    ok('the officials are told', await prisma.notification.count({ where: { caseId: K.id, title: { startsWith: 'Notice acknowledged' } } }) >= 1);
    ok('the hearing is "acknowledged" only once every issued notice is', (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'NOTICE_ISSUED');
    ok('a second acknowledgement is refused', (await rpost(H1, { action: 'acknowledge' })).status === 409);
    await np(nr.body.data.id, { action: 'acknowledge', note: 'Signed receipt at the hall' });
    ok('with the respondent\'s signed receipt recorded, it is', (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'ACKNOWLEDGED');
    const att = await rpost(H1, { action: 'attendance', intent: 'WILL_ATTEND' });
    ok('confirms they will attend - their reply, not the attendance record', att.status === 200
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.residentIntent === 'WILL_ATTEND'
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.complainantAttendance === 'NOT_RECORDED');
    ok('the officials are told of the reply', await prisma.notification.count({ where: { caseId: K.id, title: { startsWith: 'Attendance reply' } } }) >= 1);

    // ── 12. What a resident may not do ──
    console.log('\nResident limits');
    ok('another resident cannot see this hearing', !JSON.stringify(await resident(R2.cookie)).includes(H1));
    ok('another resident cannot act on it or open its notice', (await rpost(H1, { action: 'acknowledge' }, R2.cookie)).status === 404
      && (await residentNotice(req(`/api/resident/hearings/${H1}/notice`, R2.cookie), { params: Promise.resolve({ hid: H1 }) }))!.status === 404);
    ok('the complainant cannot change the record through the official routes', (await patch(K.id, H1, R1.cookie, { action: 'attendance', complainant: 'PRESENT' })).status === 401
      && (await patch(K.id, H1, R1.cookie, { action: 'reschedule', date: futureDay, time: '15:00', reason: 'I want to' })).status === 401);
    ok('the resident routes accept nothing else', (await rpost(H1, { action: 'complete', outcome: 'SETTLED' })).status === 400);

    // ── 7, 8. Asking for a new date ──
    console.log('\nRequests for a new date');
    ok('a request needs a reason', (await rpost(H1, { action: 'reschedule', reason: 'busy' })).status === 400);
    const q1 = await rpost(H1, { action: 'reschedule', reason: 'I have a medical appointment that day', preferredSchedule: 'Any morning next week' });
    const at0 = (await prisma.caseHearing.findUnique({ where: { id: H1 } }))!.scheduledAt.getTime();
    ok('the request is recorded and the date does not move', q1.status === 201 && at0 === new Date(h1r.body.data.scheduledAt).getTime());
    ok('one request at a time', (await rpost(H1, { action: 'reschedule', reason: 'Another reason that is long enough' })).status === 409);
    ok('the presiding official and the case officer are each told', await prisma.notification.count({ where: { caseId: K.id, title: { startsWith: 'New date requested' }, userId: { in: [B.id, C.id] } } }) === 2);
    const dec = await patch(K.id, H1, B.cookie, { action: 'decline_request', requestId: q1.body.data.id, note: 'Please attend; the respondent travels far.' });
    ok('an official declines it, with an answer the complainant sees', dec.status === 200
      && (await resident()).upcoming.find((h: Body) => h.id === H1)?.requests[0]?.reviewNote === 'Please attend; the respondent travels far.');
    const q2 = await rpost(H1, { action: 'reschedule', reason: 'I am still unable to attend that day, sorry' });
    const newAt = { date: today, time: '00:05' };
    const appr = await patch(K.id, H1, B.cookie, { action: 'reschedule', ...newAt, reason: 'At the complainant\'s request', requestId: q2.body.data.id });
    const h1now = await prisma.caseHearing.findUnique({ where: { id: H1 }, include: { notices: true, requests: true } });
    ok('an official approves it by setting the new date', appr.status === 200 && h1now?.status === 'RESCHEDULED' && h1now.rescheduleCount === 1
      && h1now.requests.some(r => r.status === 'APPROVED'), `${appr.status} ${appr.body.error ?? ''}`);
    ok('the old notices are marked replaced, the reply is asked again', h1now!.notices.every(x => x.status === 'SUPERSEDED') && h1now!.residentIntent === null);
    ok('the complainant is told the new date', (await feed()).some(f => /Hearing 1 has a new date/.test(f.message)));

    // ── 9, 10. Attendance, proceedings, outcome ──
    console.log('\nAttendance, proceedings and outcome');
    const H2tooEarly = await create(K.id, B.cookie, { hearingNumber: 2, date: futureDay, time: '09:00' });
    ok('hearing 2 cannot be created while hearing 1 is open', H2tooEarly.status === 422);
    ok('no outcome without attendance', (await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'CONTINUED' })).status === 400);
    ok('attendance recorded', (await patch(K.id, H1, B.cookie, { action: 'attendance', complainant: 'PRESENT', respondent: 'ABSENT' })).status === 200);
    ok('proceedings notes added', (await patch(K.id, H1, B.cookie, { action: 'proceedings', note: 'Complainant restated the complaint. Respondent absent.' })).status === 200
      && (await patch(K.id, H1, C.cookie, { action: 'proceedings', note: 'Respondent to be served again by the tanod.' })).status === 200);
    const att2 = await attachPOST(req(`/api/cases/${K.id}/hearings/${H1}/attachments`, B.cookie, 'POST', { dataUrl: PNG, filename: 'attendance-sheet.png' }), PH(K.id, H1)).then(json);
    ok('an attachment added to the hearing record', att2.status === 201);
    const aid = att2.body.data.id as string;
    ok('the officials handling it can open it; the complainant and the VAWC desk cannot', (await attachmentGET(req(`/api/attachments/${aid}`, B.cookie), { params: Promise.resolve({ id: aid }) })).status === 200
      && (await attachmentGET(req(`/api/attachments/${aid}`, R1.cookie), { params: Promise.resolve({ id: aid }) })).status === 403
      && (await attachmentGET(req(`/api/attachments/${aid}`, V.cookie), { params: Promise.resolve({ id: aid }) })).status === 403);
    const done1 = await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'RESPONDENT_ABSENT', agreements: 'None - respondent absent.',
      outcomeSummary: 'The hearing will continue on another date.', nextAction: 'Serve a new notice on the respondent', nextHearingDate: futureDay });
    ok('Hearing 1 recorded as held', done1.status === 200, `${done1.status} ${done1.body.error ?? ''}`);
    const k = await prisma.case.findUnique({ where: { id: K.id }, select: { status: true } });
    ok('a held hearing is not a resolved case', k?.status === 'Open');
    const rHist = (await resident()).history.find((g: Body) => g.case.id === K.id);
    ok('the complainant sees the permitted outcome and summary only', rHist?.hearings[0]?.outcome?.text === 'The other party did not appear.'
      && rHist.hearings[0].outcome.summary === 'The hearing will continue on another date.' && !JSON.stringify(rHist).includes('respondent absent.') && !JSON.stringify(rHist).includes('tanod'));
    ok('and is told', (await feed()).some(f => /Hearing 1 was held/.test(f.message)));
    ok('a held hearing cannot be changed back', (await patch(K.id, H1, B.cookie, { action: 'reschedule', date: futureDay, time: '09:00', reason: 'again' })).status === 409);

    // ── 2. Hearing 2 ──
    console.log('\nHearing 2 - Follow-up Hearing');
    const d2 = await detail(K.id);
    ok('the previous record is there for hearing 2, with the proposed date', d2.next === 2 && d2.hearings[0].nextHearingAt && phDay(d2.hearings[0].nextHearingAt) === futureDay);
    const h2r = await create(K.id, B.cookie, { hearingNumber: 2, date: today, time: '00:10', respondentPartyId: respondent.id });
    ok('Hearing 2 scheduled', h2r.status === 201 && h2r.body.data.status === 'SCHEDULED', `${h2r.status} ${h2r.body.error ?? ''}`);
    const H2 = h2r.body.data.id as string;
    ok('hearing 3 waits for hearing 2', (await create(K.id, B.cookie, { hearingNumber: 3, date: futureDay, time: '09:00' })).status === 422);
    ok('Hearing 2 held - continued', (await patch(K.id, H2, B.cookie, { action: 'complete', outcome: 'CONTINUED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT',
      agreements: 'Respondent agreed to lower the volume after 10 PM; to be confirmed at hearing 3.' })).status === 200);

    // ── 3. Hearing 3 ──
    console.log('\nHearing 3 - Further Proceeding');
    const h3r = await create(K.id, B.cookie, { hearingNumber: 3, date: today, time: '00:15', respondentPartyId: respondent.id });
    ok('Hearing 3 scheduled', h3r.status === 201, `${h3r.status} ${h3r.body.error ?? ''}`);
    const H3 = h3r.body.data.id as string;
    const d3 = await detail(K.id);
    ok('hearing 3 has hearings 1 and 2 on record beside it', d3.hearings.length === 3 && d3.hearings.filter((h: Body) => h.status === 'COMPLETED').length === 2);
    ok('no next hearing date after hearing 3', (await patch(K.id, H3, B.cookie, { action: 'complete', outcome: 'CONTINUED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT', nextHearingDate: futureDay })).status === 400);
    ok('Hearing 3 held - certification to file action, with the next action', (await patch(K.id, H3, B.cookie, { action: 'complete', outcome: 'CERTIFICATE_TO_FILE',
      complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT', nextAction: 'Issue the certification to file action' })).status === 200);
    ok('no fourth hearing', (await create(K.id, B.cookie, { hearingNumber: 4, date: futureDay, time: '09:00' })).status === 400 && (await detail(K.id)).next === null);

    // ── 11. History ──
    console.log('\nHistory');
    const ev = await prisma.caseHearingEvent.findMany({ where: { hearingId: H1 }, orderBy: { createdAt: 'asc' } });
    const kinds = ev.map(e => e.kind);
    ok('every step of hearing 1 is in its history', ['created', 'updated', 'scheduled', 'notice_generated', 'notice_issued', 'notice_delivery', 'notice_acknowledged',
      'resident_intent', 'reschedule_requested', 'request_declined', 'request_approved', 'rescheduled', 'attendance', 'proceedings_note', 'attachment_added', 'outcome']
      .every(x => kinds.includes(x)), kinds.join(','));
    const resch = ev.find(e => e.kind === 'rescheduled');
    ok('the old date is kept beside the new one', (resch?.before as Body)?.scheduledAt === new Date(h1r.body.data.scheduledAt).toISOString() && phDay((resch?.after as Body).scheduledAt) === today);
    ok('both proceedings notes are kept, by whom', ev.filter(e => e.kind === 'proceedings_note').length === 2 && new Set(ev.filter(e => e.kind === 'proceedings_note').map(e => e.actorId)).size === 2);
    let blocked = false;
    try { await prisma.caseHearingEvent.update({ where: { id: ev[0].id }, data: { note: 'rewritten' } }); } catch { blocked = true; }
    ok('the database refuses to rewrite a history row', blocked);
    blocked = false;
    try { await prisma.caseKpReview.updateMany({ where: { caseId: K.id }, data: { decision: 'ELIGIBLE' } }); } catch { blocked = true; }
    ok('or an eligibility review', blocked);
    blocked = false;
    try { await prisma.caseHearing.create({ data: { caseId: K.id, reference: `${TAG}-dup`, hearingNumber: 9, scheduledAt: new Date(), createdById: B.id, updatedById: B.id } }); } catch { blocked = true; }
    ok('the database refuses a hearing number outside 1-3', blocked);

    // ── Cancelling, replacing, presiding, the list ──
    console.log('\nCancel, replace, the list and the calendar data');
    const c1 = await create(K2.id, B.cookie, { hearingNumber: 1, date: futureDay, time: '14:00', assignedOfficialId: B2.id });
    ok('hearing 1 on another case, presided by another officer', c1.status === 201);
    ok('the presiding officer may view and run it', (await json(await caseHearingsGET(req(`/api/cases/${K2.id}/hearings`, B2.cookie), P(K2.id)))).status === 200
      && (await patch(K2.id, c1.body.data.id, B2.cookie, { action: 'proceedings', note: 'Pre-hearing call with the complainant.' })).status === 200);
    ok('cancelled, with the reason', (await patch(K2.id, c1.body.data.id, B.cookie, { action: 'cancel', reason: 'Complainant withdrew before the hearing' })).status === 200);
    const k2feed = (await feed()).filter(f => f.caseId === K2.id);
    ok('the complainant is told it was cancelled - not why', k2feed.some(f => /Hearing 1 was cancelled/.test(f.message)) && !k2feed.some(f => /withdrew/.test(f.message)));
    const c2 = await create(K2.id, B.cookie, { hearingNumber: 1, date: phDay(new Date(Date.now() + 3 * 3_600_000)), time: phDay(new Date(Date.now() + 3 * 3_600_000)) === today ? '23:59' : '01:00' });
    ok('a cancelled hearing may be replaced, under its own reference', c2.status === 201 && c2.body.data.reference === `HRG-${K2.caseNumber}-H1-2`, `${c2.status} ${c2.body.error ?? ''}`);
    const lB = (await json(await listGET(req('/api/hearings', B.cookie)))).body.data;
    ok('the list holds the officer\'s hearings', lB.rows.filter((r: Body) => r.case.id === K.id).length === 3 && lB.rows.some((r: Body) => r.case.id === K2.id));
    const lB2 = (await json(await listGET(req('/api/hearings', B2.cookie)))).body.data;
    ok('another officer sees only what they preside over', !lB2.rows.some((r: Body) => r.case.id === K.id) && lB2.rows.some((r: Body) => r.case.id === K2.id));
    const l2 = (await json(await listGET(req(`/api/hearings?number=2&q=${K.caseNumber}`, C.cookie)))).body.data;
    ok('the Hearing 2 tab shows hearing 2 only', l2.rows.length === 1 && l2.rows[0].hearingNumber === 2);
    const lS = await json(await listGET(req('/api/hearings', S.cookie)));
    ok('the system administrator can view the list but not create', lS.status === 200 && lS.body.data.canCreate === false);

    // ── Reminders ──
    console.log('\nReminders');
    process.env.CRON_SECRET = `${TAG}-secret`;
    const cron = () => cronGET(req(`/api/cron/hearing-reminders?key=${TAG}-secret`, '')).then(json);
    await prisma.caseHearing.update({ where: { id: c2.body.data.id }, data: { scheduledAt: new Date(Date.now() + 3 * 3_600_000) } });
    const cr = await cron();
    ok('a hearing within a day is reminded', cr.status === 200 && (await prisma.caseHearing.findUnique({ where: { id: c2.body.data.id } }))?.reminderSentAt !== null);
    await cron();
    ok('...once', await prisma.caseHearingEvent.count({ where: { hearingId: c2.body.data.id, kind: 'reminder' } }) === 1);
    ok('the complainant gets the reminder', (await feed()).some(f => f.caseId === K2.id && /Reminder: Hearing 1/.test(f.message)));
    ok('without the secret, nothing runs', (await cronGET(req('/api/cron/hearing-reminders?key=wrong', '')).then(json)).status === 401);

    // ── 15. Analytics ──
    console.log('\nAnalytics');
    const after = (await getA('hearings', C.cookie, 'scope=blotter')).body.data;
    const dd = (k: string) => after[k] - before[k];
    ok('total, completed, rescheduled, cancelled and upcoming move with the records', dd('totalScheduled') === 5 && dd('completed') === 3 && dd('rescheduled') === 1
      && dd('cancelled') === 1 && dd('upcomingCount') === 1, JSON.stringify({ t: dd('totalScheduled'), c: dd('completed'), r: dd('rescheduled'), x: dd('cancelled'), u: dd('upcomingCount') }));
    ok('the Hearing 1, 2 and 3 distribution', after.byNumber[0].completed - before.byNumber[0].completed === 1 && after.byNumber[1].completed - before.byNumber[1].completed === 1
      && after.byNumber[2].completed - before.byNumber[2].completed === 1 && after.byNumber[0].cancelled - before.byNumber[0].cancelled === 1);
    const ranged = (await getA('hearings', C.cookie, 'scope=blotter&from=2020-01-01&to=2020-01-02')).body.data;
    ok('the date filter applies to the counts', ranged.totalScheduled === 0 && ranged.completed === 0);
    const vawcBoard = (await getA('hearings', V.cookie, 'scope=vawc')).body.data;
    ok('the VAWC board counts no hearings', vawcBoard.applicable === false && vawcBoard.totalScheduled === 0 && vawcBoard.upcoming.length === 0);
  } finally {
    if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.caseHearing.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.caseHearingEvent.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.caseHearingNotice.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.hm.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
