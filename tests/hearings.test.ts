/**
 * Hearing Management - the Katarungang Pambarangay proceedings (mediation,
 * constitution of the Pangkat, conciliation) - through the real routes and
 * the real database (in-process; no dev server needed).
 * Run with:  npm run test:hearings
 *
 * The nine workflow tests of the specification are marked TEST 1 to TEST 9;
 * the rest covers eligibility, permissions, the calendar, conflicts,
 * reminders, history and analytics. Temporary rows are marked PROBE-HM and
 * removed at the end; counts that the real data also feeds are read before
 * and checked by how much they changed.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import {
  hearingEligibility, hearingRefusal, nextStep, outcomeLeadsTo, statusFromNotices, residentHearingMessage, partyFormsFor, phDay, KP_KEYS, KP_CHECKLIST, STAGE_OUTCOMES, decideKpReview, type KpAnswers,
} from '../lib/hearings';
import { decideHearingAccess, pangkatRefusal } from '../lib/hearingsServer';
import { kpNoticeBody } from '../lib/kpNoticesPdf';
import { parseHours } from '../lib/safecommConfig';
import { GET as conflictsGET } from '../app/api/hearings/conflicts/route';
import { GET as caseHearingsGET, POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { PATCH as hearingPATCH } from '../app/api/cases/[id]/hearings/[hid]/route';
import { GET as noticePreview, POST as noticePOST } from '../app/api/cases/[id]/hearings/[hid]/notices/route';
import { PATCH as noticePATCH } from '../app/api/cases/[id]/hearings/[hid]/notices/[nid]/route';
import { GET as noticePDF } from '../app/api/cases/[id]/hearings/[hid]/notices/[nid]/pdf/route';
import { POST as attachPOST } from '../app/api/cases/[id]/hearings/[hid]/attachments/route';
import { GET as pangkatGET, POST as pangkatPOST } from '../app/api/cases/[id]/pangkat/route';
import { POST as linkPOST, DELETE as linkDELETE } from '../app/api/cases/[id]/parties/[pid]/account/route';
import { POST as kpPOST } from '../app/api/cases/[id]/kp-review/route';
import { GET as listGET } from '../app/api/hearings/route';
import { GET as candidatesGET } from '../app/api/hearings/cases/route';
import { POST as claimPOST } from '../app/api/cases/[id]/claim/route';
import { PATCH as classPATCH } from '../app/api/cases/[id]/classification/route';
import { PUT as recordsPUT } from '../app/api/cases/[id]/records/route';
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
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
  return out.replace(/\s+/g, ' ');
}
// Every point answered Yes - the earlier tick-box form had every box ticked.
const allYes = Object.fromEntries(KP_KEYS.map(k => [k, 'YES']));
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
    ok('an earlier tick-box "not eligible" is reviewed again - it never recorded an exclusion', (() => {
      const e = hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review: { ...review, decision: 'NOT_ELIGIBLE', note: 'x' } });
      return !e.eligible && e.state === 'PENDING_REVIEW' && e.needsReview && /old checklist/.test(e.reasons[0]); })());
    ok('decisions: unanswered is pending; unknown needs verification; a No is not eligible; all cleared needs approval',
      decideKpReview({}, false).decision === 'PENDING_REVIEW'
      && decideKpReview({ ...allYes, venue: 'UNKNOWN' } as KpAnswers, false).decision === 'NEEDS_VERIFICATION'
      && decideKpReview({ venue: 'NO' } as KpAnswers, false).decision === 'NOT_ELIGIBLE'
      && decideKpReview({ ...allYes, venue: 'NO', residence: 'UNKNOWN' } as KpAnswers, true).decision === 'NOT_ELIGIBLE'
      && decideKpReview(allYes as KpAnswers, false).decision === 'PENDING_REVIEW'
      && decideKpReview(allYes as KpAnswers, true).decision === 'ELIGIBLE');
    ok('the checklist covers secs. 408(a)-(g), 409, 412(b) and RA 9262', ['408(a)', '408(b)', '408(c)', '408(d)', '408(e)', '408(f)', '408(g)', 'sec. 409', '412(b)', 'RA 9262']
      .every(b => KP_CHECKLIST.some(c => c.basis.includes(b))));
    ok('a VAWC case is not eligible whatever the review says', hearingEligibility({ caseType: 'Domestic Violence', status: 'Open', verifiedCategory: { caseType: 'Domestic Violence', at: new Date() },
      review: { decision: 'ELIGIBLE', caseType: 'Domestic Violence', at: new Date(), version: 2, checklist: allYes, approvedById: 'x' } }).state === 'NOT_ELIGIBLE');
    ok('a closed case is not', !hearingEligibility({ caseType: 'Noise Complaint', status: 'Closed', verifiedCategory: verified, review }).eligible);
    ok('filed on the VAWC form or read as VAWC by the AI: a warning', hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: verified, review, reportPath: 'VAWC', aiSuggestedCategory: 'Domestic Violence' }).warnings.length === 2);
    const done = (stage: string, outcome: string, n = 1) => ({ hearingNumber: n, stage, session: 1, status: 'COMPLETED', outcome });
    ok('every case starts with mediation', nextStep('Noise Complaint', [], false).stage === 'MEDIATION');
    ok('one open proceeding at a time', nextStep('Noise Complaint', [{ hearingNumber: 1, stage: 'MEDIATION', session: 1, status: 'NOTICE_ISSUED' }], false).stage === null);
    ok('mediation without settlement leads to the constitution of the Pangkat', nextStep('Noise Complaint', [done('MEDIATION', 'NOT_SETTLED')], false).stage === 'CONSTITUTION');
    ok('a continued mediation is another mediation session', (() => { const s = nextStep('Noise Complaint', [done('MEDIATION', 'CONTINUED')], false); return s.stage === 'MEDIATION' && s.session === 2; })());
    ok('a settlement ends the proceedings', nextStep('Noise Complaint', [done('MEDIATION', 'SETTLED')], false).refusal?.includes('ended') === true);
    ok('no conciliation before the Pangkat is constituted', /not been constituted/.test(nextStep('Noise Complaint', [done('MEDIATION', 'NOT_SETTLED'), done('CONSTITUTION', 'PANGKAT_CONSTITUTED', 2)], false).refusal ?? ''));
    ok('conciliation once it is', nextStep('Noise Complaint', [done('MEDIATION', 'NOT_SETTLED'), done('CONSTITUTION', 'PANGKAT_CONSTITUTED', 2)], true).stage === 'CONCILIATION');
    ok('asking for a stage out of order is refused', hearingRefusal('Noise Complaint', [], 'CONCILIATION', true) !== null && hearingRefusal('Noise Complaint', [], 'MEDIATION') === null);
    ok('a cancelled proceeding may be replaced', nextStep('Noise Complaint', [{ hearingNumber: 1, stage: 'MEDIATION', session: 1, status: 'CANCELLED' }], false).stage === 'MEDIATION');
    ok('a certification to file action ends it; it is an outcome of conciliation only', outcomeLeadsTo('CONCILIATION', 'CERTIFICATE_TO_FILE') === null
      && STAGE_OUTCOMES.CONCILIATION.includes('CERTIFICATE_TO_FILE') && !STAGE_OUTCOMES.MEDIATION.includes('CERTIFICATE_TO_FILE'));
    ok('the forms per stage: KP 8 and 9, KP 10 to both, KP 12 to both', partyFormsFor('MEDIATION').map(f => `${f.formNo}${f.recipientRole[0]}`).join() === '8C,9R'
      && partyFormsFor('CONSTITUTION').map(f => f.formNo).join() === '10,10' && partyFormsFor('CONCILIATION').map(f => f.formNo).join() === '12,12');
    ok('the form wording follows the handbook', /for the hearing of your complaint/.test(kpNoticeBody({ formNo: 8, scheduledAt: new Date() })[0])
      && kpNoticeBody({ formNo: 9, scheduledAt: new Date() }).some(p => p.startsWith('FAIL NOT')) && /drawing lots/.test(kpNoticeBody({ formNo: 10, scheduledAt: new Date() })[0]));
    ok('a generated notice changes nothing; an issued one does; a new date reads rescheduled until acknowledged',
      statusFromNotices({ status: 'SCHEDULED', rescheduleCount: 0 }, [{ status: 'GENERATED' }]) === 'SCHEDULED'
      && statusFromNotices({ status: 'SCHEDULED', rescheduleCount: 0 }, [{ status: 'ISSUED' }]) === 'NOTICE_ISSUED'
      && statusFromNotices({ status: 'RESCHEDULED', rescheduleCount: 1 }, [{ status: 'ISSUED' }]) === 'RESCHEDULED'
      && statusFromNotices({ status: 'NOTICE_ISSUED', rescheduleCount: 0 }, [{ status: 'ACKNOWLEDGED' }, { status: 'ACKNOWLEDGED' }]) === 'ACKNOWLEDGED');
    ok('a party is not told of notes, attendance, the other party\'s notice, or a cancelled draft',
      residentHearingMessage({ kind: 'proceedings_note', after: { hearingNumber: 1 } }) === null
      && residentHearingMessage({ kind: 'attendance', after: { hearingNumber: 1 } }) === null
      && residentHearingMessage({ kind: 'notice_issued', after: { hearingNumber: 1, recipientRole: 'RESPONDENT', formNo: 9 } }, 'COMPLAINANT') === null
      && residentHearingMessage({ kind: 'notice_issued', after: { hearingNumber: 1, recipientRole: 'RESPONDENT', formNo: 9 } }, 'RESPONDENT')?.includes('KP Form No. 9') === true
      && residentHearingMessage({ kind: 'cancelled', after: { hearingNumber: 1, wasDraft: true } }) === null);
    ok('a request\'s answer goes to the party who asked', residentHearingMessage({ kind: 'request_declined', after: { hearingNumber: 1, requesterRole: 'RESPONDENT' } }, 'COMPLAINANT') === null
      && residentHearingMessage({ kind: 'request_declined', after: { hearingNumber: 1, requesterRole: 'RESPONDENT' } }, 'RESPONDENT') !== null);
    ok('a Pangkat needs three members and two officers', pangkatRefusal(null) !== null
      && pangkatRefusal({ chairmanMemberId: 'a', secretaryMemberId: 'a', members: ['a', 'b', 'c'].map(id => ({ id, removedAt: null })) }) !== null
      && pangkatRefusal({ chairmanMemberId: 'a', secretaryMemberId: 'b', members: ['a', 'b', 'c'].map(id => ({ id, removedAt: null })) }) === null);
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
    const mkRes = async (k: string, first: string, last: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: first, lastName: last, age: 34, gender: 'Female', barangay: 'Ayukit', address: `${k} private address`, contactNumber: `0917000${process.pid % 10000}`, emailVerified: true } });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const R1 = await mkRes('a', 'Maria', 'Complainanta');   // files the cases: the complainant
    const R2 = await mkRes('b', 'Lorna', 'Outsider');       // a party to nothing here
    const R3 = await mkRes('c', 'Juan', 'Respondente');     // the respondent on case K
    const R4 = await mkRes('d', 'Pedro', 'Neighbore');      // the respondent on case K2, linked late
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Maria Complainanta', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'temporary test case narrative', status: 'Open', riskLevel: 'Low', residentId: R1.id, assignedToId: B.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const eligible = async (caseId: string, by: string) => {
      await prisma.assessmentHistory.create({ data: { caseId, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: by } });
      await prisma.caseKpReview.create({ data: { caseId, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: allYes, reviewedById: by,
        version: 2, approvedById: by, approvedAt: new Date() } });
    };
    const K = await mkCase({});
    const respondent = await prisma.caseParty.create({ data: { caseId: K.id, role: 'REPORTED', fullName: 'Juan Respondente', address: '7 Secret Lane', source: 'reporter' } });
    const KV = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });
    const K2 = await mkCase({});
    const respondent2 = await prisma.caseParty.create({ data: { caseId: K2.id, role: 'REPORTED', fullName: 'Pedro Neighbore', source: 'official' } });
    await eligible(K2.id, B.id);

    const P = (id: string) => ({ params: Promise.resolve({ id }) });
    const PH = (id: string, hid: string) => ({ params: Promise.resolve({ id, hid }) });
    const PN = (id: string, hid: string, nid: string) => ({ params: Promise.resolve({ id, hid, nid }) });
    const PP = (id: string, pid: string) => ({ params: Promise.resolve({ id, pid }) });
    const create = (caseId: string, cookie: string, body: Body) => caseHearingsPOST(req(`/api/cases/${caseId}/hearings`, cookie, 'POST', body), P(caseId)).then(json);
    const patch = (caseId: string, hid: string, cookie: string, body: Body) => hearingPATCH(req(`/api/cases/${caseId}/hearings/${hid}`, cookie, 'PATCH', body), PH(caseId, hid)).then(json);
    const detail = async (caseId: string, cookie = B.cookie) => (await json(await caseHearingsGET(req(`/api/cases/${caseId}/hearings`, cookie), P(caseId)))).body.data;
    const resident = async (cookie: string) => (await json(await residentGET(req('/api/resident/hearings', cookie)))).body.data;
    const rpost = (hid: string, body: Body, cookie: string) => residentPOST(req(`/api/resident/hearings/${hid}`, cookie, 'POST', body), { params: Promise.resolve({ hid }) }).then(json);
    const rnotice = (hid: string, cookie: string, id?: string) => residentNotice(req(`/api/resident/hearings/${hid}/notice${id ? `?id=${id}` : ''}`, cookie), { params: Promise.resolve({ hid }) });
    const feed = async (cookie: string) => ((await json(await updatesGET(req('/api/resident/updates?limit=20', cookie)))).body.data ?? []) as Body[];
    const link = (caseId: string, pid: string, cookie: string, residentNumber: string) => linkPOST(req(`/api/cases/${caseId}/parties/${pid}/account`, cookie, 'POST', { residentNumber }), PP(caseId, pid)).then(json);
    const pk = (caseId: string, cookie: string, body: Body) => pangkatPOST(req(`/api/cases/${caseId}/pangkat`, cookie, 'POST', body), P(caseId)).then(json);
    const getA = (section: string, cookie: string, q = '') => analyticsGET(req(`/api/analytics/${section}?${q}`, cookie), { params: Promise.resolve({ section }) }).then(json);
    const before = (await getA('hearings', C.cookie, 'scope=blotter')).body.data;
    const today = phDay(new Date());
    const future = new Date(Date.now() + 5 * 86_400_000);
    const futureDay = phDay(future);
    // A hearing's day "arrives": set its time just past, as the clock would.
    const arrive = (hid: string) => prisma.caseHearing.update({ where: { id: hid }, data: { scheduledAt: new Date(Date.now() - 2 * 60_000) } });
    const mine = (data: Body, hid: string) => data.history.flatMap((g: Body) => g.hearings).find((h: Body) => h.id === hid);

    // ── TEST 9. VAWC protection ──
    console.log('\nTEST 9 - a VAWC case stays out of ordinary KP proceedings');
    const vv = await create(KV.id, V.cookie, { date: futureDay, time: '09:00' });
    ok('the VAWC officer cannot schedule mediation on a VAWC case', vv.status === 422 && /RA 9262/.test(vv.body.error ?? ''), `${vv.status}`);
    ok('nor can the captain', (await create(KV.id, C.cookie, { stage: 'MEDIATION', date: futureDay, time: '09:00' })).status === 422);
    ok('no eligibility review can be recorded on it', (await json(await kpPOST(req(`/api/cases/${KV.id}/kp-review`, C.cookie, 'POST', { answers: allYes, approve: true }), P(KV.id)))).status === 422);
    ok('no Pangkat can be recorded on it', (await pk(KV.id, C.cookie, { action: 'add_member', name: 'Someone Lupon', chosenBy: 'BOTH_PARTIES' })).status !== 200);
    ok('to the blotter desk the VAWC case is not found', (await json(await caseHearingsGET(req(`/api/cases/${KV.id}/hearings`, B.cookie), P(KV.id)))).status === 404);
    const vlist = await json(await listGET(req('/api/hearings', V.cookie)));
    ok('Hearing Management refuses the VAWC desk, with the reason - its own workflow stays separate', vlist.status === 403 && /RA 9262/.test(vlist.body.error ?? ''));
    const cand = (await json(await candidatesGET(req(`/api/hearings/cases?q=${KV.caseNumber}`, C.cookie)))).body.data as Body;
    ok('a VAWC case looked up by number is shown with why it cannot have a hearing - and is not offered', cand.vawc?.id === KV.id && /RA 9262/.test(cand.vawc.reason)
      && !cand.rows.some((r: Body) => r.id === KV.id));

    // ── Eligibility ──
    console.log('\nEligibility checkpoint');
    const e1 = await create(K.id, B.cookie, { date: futureDay, time: '09:00' });
    ok('without a verified category: refused, and why', e1.status === 422 && /category/i.test(e1.body.error ?? ''));
    await prisma.assessmentHistory.create({ data: { caseId: K.id, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
    const e2 = await create(K.id, B.cookie, { date: futureDay, time: '09:00' });
    ok('without an official\'s eligibility review: refused', e2.status === 422 && /review/i.test(e2.body.error ?? ''));
    const kp = (cookie: string, body: Body) => kpPOST(req(`/api/cases/${K.id}/kp-review`, cookie, 'POST', body), P(K.id)).then(json);
    const refused = async () => (await create(K.id, B.cookie, { date: futureDay, time: '09:00' })).status === 422;
    const part = await kp(B.cookie, { answers: { not_vawc: 'YES', individuals: 'YES' } });
    ok('unanswered points do not make the case not eligible: the review is pending', part.status === 201 && part.body.data.review.decision === 'PENDING_REVIEW'
      && part.body.data.eligibility.state === 'PENDING_REVIEW' && /not finished - 8 points/.test(part.body.data.eligibility.reasons.join(' ')));
    ok('...and no proceeding can be created yet', await refused());
    const unk = await kp(B.cookie, { answers: { ...allYes, residence: 'UNKNOWN', real_property: 'NOT_APPLICABLE' } });
    ok('an unknown answer: needs verification, saying which point', unk.status === 201 && unk.body.data.review.decision === 'NEEDS_VERIFICATION'
      && unk.body.data.eligibility.state === 'NEEDS_VERIFICATION' && /where the parties reside/.test(unk.body.data.eligibility.reasons[0]) && await refused());
    ok('the answers are kept to continue the review', (await detail(K.id)).eligibility.answers?.residence === 'UNKNOWN' && (await detail(K.id)).eligibility.needsReview === true);
    ok('"not applicable" only where the point can not arise', (await kp(B.cookie, { answers: { ...allYes, venue: 'NOT_APPLICABLE' } })).status === 400);
    ok('a review with an unknown point cannot be approved', (await kp(B.cookie, { answers: { ...allYes, residence: 'UNKNOWN' }, approve: true })).status === 400);
    const unapproved = await kp(B.cookie, { answers: allYes });
    ok('every point cleared but not approved: still pending, waiting for approval', unapproved.body.data?.review.decision === 'PENDING_REVIEW'
      && /must approve/.test(unapproved.body.data.eligibility.reasons.join(' ')) && await refused());
    ok('an exclusion needs the basis it rests on', (await kp(B.cookie, { answers: { ...allYes, offence_limit: 'NO' } })).status === 400);
    const ne = await kp(B.cookie, { answers: { ...allYes, offence_limit: 'NO' }, note: 'Slight physical injuries with a weapon - checked against the RPC penalty' });
    ok('a recorded exclusion: not eligible, with the legal basis', ne.status === 201 && ne.body.data.review.decision === 'NOT_ELIGIBLE' && !ne.body.data.eligibility.eligible
      && ne.body.data.eligibility.exclusions.some((x: Body) => x.key === 'offence_limit' && x.basis === 'RA 7160 sec. 408(c)'));
    ok('a verified exclusion blocks the proceeding', await refused());
    ok('and is not cleared without saying what changed', (await kp(B.cookie, { answers: allYes, approve: true })).status === 400);
    ok('the system administrator cannot record a review', (await kp(S.cookie, { answers: allYes, approve: true })).status === 403);
    ok('nor can another officer, nor a resident', (await kp(B2.cookie, { answers: allYes, approve: true })).status === 403
      && (await kp(R1.cookie, { answers: allYes, approve: true })).status === 401);
    let badRow = false;
    try { await prisma.caseKpReview.create({ data: { caseId: K.id, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: allYes, reviewedById: B.id, version: 2 } }); badRow = true; } catch { /* refused */ }
    ok('the database refuses an eligible review without the approving official', !badRow);
    const full = await kp(B.cookie, { answers: { ...allYes, real_property: 'NOT_APPLICABLE' }, approve: true, note: 'Re-checked: the injury was minor, no weapon' });
    ok('a full, approved review makes the case eligible, with the approving official', full.body.data?.eligibility.eligible === true
      && full.body.data.eligibility.state === 'ELIGIBLE' && full.body.data.review.approvedById === B.id && full.body.data.review.version === 2);
    ok('every review is kept', await prisma.caseKpReview.count({ where: { caseId: K.id } }) === 5);

    console.log('\nWho may create');
    ok('another blotter officer may not', (await create(K.id, B2.cookie, { date: futureDay, time: '09:00' })).status === 403);
    ok('the system administrator may not', (await create(K.id, S.cookie, { date: futureDay, time: '09:00' })).status === 403);
    ok('a resident session is not an official', (await create(K.id, R1.cookie, { date: futureDay, time: '09:00' })).status === 401);
    ok('the system administrator may view', (await json(await caseHearingsGET(req(`/api/cases/${K.id}/hearings`, S.cookie), P(K.id)))).status === 200);
    ok('no date in the past', (await create(K.id, B.cookie, { date: '2020-01-01', time: '09:00' })).status === 400);
    ok('the respondent must be a person recorded on this case', (await create(K.id, B.cookie, { date: futureDay, time: '09:00', respondentPartyId: 'not-a-party' })).status === 400);
    ok('conciliation cannot be asked for first', (await create(K.id, B.cookie, { stage: 'CONCILIATION', date: futureDay, time: '09:00' })).status === 422);

    // ── Party accounts ──
    console.log('\nLinking the respondent to their SafeComm account');
    ok('an unknown resident number is refused', (await link(K.id, respondent.id, B.cookie, `${TAG}-nobody`)).status === 404);
    ok('the reporter cannot be linked as the respondent of their own case', (await link(K.id, respondent.id, B.cookie, R1.residentNumber)).status === 409);
    ok('a resident cannot link accounts', (await link(K.id, respondent.id, R3.cookie, R3.residentNumber)).status === 401);
    const lk = await link(K.id, respondent.id, B.cookie, R3.residentNumber);
    ok('linked by the exact resident number', lk.status === 200 && (await prisma.caseParty.findUnique({ where: { id: respondent.id } }))?.residentId === R3.id, `${lk.status} ${lk.body.error ?? ''}`);

    // ── TEST 1. The mediation schedule ──
    console.log('\nTEST 1 - mediation schedule: KP Form No. 8 and No. 9 for one schedule');
    const draft = await create(K.id, B.cookie, { date: futureDay, time: '09:30', venue: 'Barangay Hall, session room', assignedOfficialId: C.id,
      notes: 'Internal: both families are neighbours', residentInstructions: 'Bring the photos of the speaker', asDraft: true });
    ok('mediation is created as a draft (the only respondent is chosen)', draft.status === 201 && draft.body.data.status === 'DRAFT' && draft.body.data.stage === 'MEDIATION'
      && draft.body.data.reference === `HRG-${K.caseNumber}-M1` && draft.body.data.respondentPartyId === respondent.id, `${draft.status} ${draft.body.error ?? ''}`);
    const H1 = draft.body.data.id as string;
    ok('a draft makes no notice and is not shown to either party', await prisma.caseHearingNotice.count({ where: { hearingId: H1 } }) === 0
      && !mine(await resident(R1.cookie), H1) && !mine(await resident(R3.cookie), H1));
    ok('the presiding official is told', await prisma.notification.count({ where: { caseId: K.id, userId: C.id, title: { contains: 'assigned to the mediation' } } }) === 1);
    ok('a second proceeding cannot be created while it is open', (await create(K.id, B.cookie, { date: futureDay, time: '10:00' })).status === 422);
    ok('the draft can be edited', (await patch(K.id, H1, B.cookie, { action: 'update', venue: 'Barangay Hall' })).status === 200);
    const preview = await noticePreview(req(`/api/cases/${K.id}/hearings/${H1}/notices?recipient=RESPONDENT`, B.cookie), PH(K.id, H1));
    const pv = await pdfText(preview);
    ok('the officer can preview the summons - marked not issued, nothing stored', preview!.status === 200 && pv.includes('S U M M O N S') && pv.includes('PREVIEW')
      && await prisma.caseHearingNotice.count({ where: { hearingId: H1 } }) === 0);
    const sch = await patch(K.id, H1, B.cookie, { action: 'schedule' });
    const h1 = await prisma.caseHearing.findUnique({ where: { id: H1 }, include: { notices: true } });
    const kp8 = h1!.notices.find(x => x.formNo === 8), kp9 = h1!.notices.find(x => x.formNo === 9);
    ok('scheduled: one proceeding, saved in the database', sch.status === 200 && await prisma.caseHearing.count({ where: { caseId: K.id } }) === 1, `${sch.status} ${sch.body.error ?? ''}`);
    ok('KP Form No. 8 is made for the complainant', kp8?.recipientRole === 'COMPLAINANT' && kp8.noticeNumber === `KP8-${K.caseNumber}-M1-C1` && kp8.recipientName === 'Maria Complainanta');
    ok('KP Form No. 9 is made for the respondent', kp9?.recipientRole === 'RESPONDENT' && kp9.noticeNumber === `KP9-${K.caseNumber}-M1-R1` && kp9.recipientName === 'Juan Respondente');
    ok('both refer to the same mediation schedule', h1!.notices.length === 2 && kp8!.hearingId === kp9!.hearingId
      && kp8!.scheduledAt.getTime() === h1!.scheduledAt.getTime() && kp9!.scheduledAt.getTime() === h1!.scheduledAt.getTime());
    ok('both parties have accounts: each notice is delivered to its own account', kp8!.channel === 'SAFECOMM_ACCOUNT' && kp8!.recipientResidentId === R1.id
      && kp9!.channel === 'SAFECOMM_ACCOUNT' && kp9!.recipientResidentId === R3.id && kp8!.status === 'ISSUED' && h1!.status === 'NOTICE_ISSUED');
    ok('a second notice to the same party for the same date is refused - no duplicates',
      (await json(await noticePOST(req(`/api/cases/${K.id}/hearings/${H1}/notices`, B.cookie, 'POST', { recipient: 'COMPLAINANT' }), PH(K.id, H1)))).status === 409
      && await prisma.caseHearingNotice.count({ where: { hearingId: H1 } }) === 2);
    const off8 = await pdfText(await noticePDF(req(`/api/cases/${K.id}/hearings/${H1}/notices/${kp8!.id}/pdf`, B.cookie), PN(K.id, H1, kp8!.id)));
    ok('the officer prints KP 8: its title, the barangay, the recipient, the schedule, the venue and a signature area',
      off8.includes('NOTICE OF HEARING') && off8.includes('(MEDIATION PROCEEDINGS)') && off8.includes('Republic of the Philippines') && /bocaue/i.test(off8)
      && off8.includes('Maria Complainanta') && off8.includes('Punong Barangay/Lupon Chairman') && off8.includes('Venue: Barangay Hall') && !off8.includes('PREVIEW'), off8.slice(0, 300));

    // ── TEST 2. The complainant ──
    console.log('\nTEST 2 - the complainant sees the mediation and KP Form No. 8');
    const r1 = await resident(R1.cookie);
    const up1 = r1.upcoming.find((h: Body) => h.id === H1);
    ok('it appears under My Hearings & Notices with the case, stage, date, time and venue', up1 && up1.case.caseNumber === K.caseNumber && up1.stage === 'MEDIATION'
      && up1.venue === 'Barangay Hall' && up1.role === 'COMPLAINANT' && up1.instructions.some((i: string) => i.includes('photos')));
    ok('with only their own notice - KP 8 - its status and the issuing official', up1.notices.length === 1 && up1.notices[0].formNo === 8
      && up1.notices[0].formName.startsWith('KP Form No. 8') && up1.notices[0].issuedBy === `${TAG} blotter`);
    const c8 = await rnotice(H1, R1.cookie);
    const c8t = await pdfText(c8);
    ok('the complainant opens KP Form No. 8', c8!.status === 200 && c8t.includes('(MEDIATION PROCEEDINGS)') && c8t.includes('for the hearing of your complaint') && !c8t.includes('S U M M O N S'));
    ok('they cannot open the respondent\'s summons', (await rnotice(H1, R1.cookie, kp9!.id))!.status === 404);
    ok('opening it is recorded as seen - not acknowledged', (await prisma.caseHearingNotice.findUnique({ where: { id: kp8!.id } }))?.seenAt !== null
      && (await prisma.caseHearingNotice.findUnique({ where: { id: kp8!.id } }))?.status === 'ISSUED');
    ok('nothing the officials keep or the respondent\'s details', !/Internal: both families|Juan Respondente|7 Secret Lane|PROBE-HM captain|c private address/.test(JSON.stringify(r1)));
    const f1 = await feed(R1.cookie);
    ok('the complainant is notified, with the case and schedule, naming no official', f1.some(f => f.caseNumber === K.caseNumber && /Mediation is scheduled for/.test(f.message))
      && f1.some(f => /Your KP Form No. 8/.test(f.message)) && !f1.some(f => /PROBE-HM/.test(f.message)));

    // ── TEST 3. The respondent ──
    console.log('\nTEST 3 - the respondent sees the same mediation and KP Form No. 9');
    const r3 = await resident(R3.cookie);
    const up3 = r3.upcoming.find((h: Body) => h.id === H1);
    ok('the same mediation schedule appears in the respondent\'s account', up3 && up3.role === 'RESPONDENT' && up3.scheduledAt === up1.scheduledAt && up3.reference === up1.reference);
    ok('with only KP Form No. 9', up3.notices.length === 1 && up3.notices[0].formNo === 9);
    const s9 = await pdfText(await rnotice(H1, R3.cookie));
    ok('the respondent opens the summons, with its warning and the officer\'s return', s9.includes('S U M M O N S') && s9.includes('Juan Respondente') && s9.includes('FAIL NOT')
      && s9.includes("OFFICER'S RETURN") && s9.includes(K.caseNumber));
    ok('they cannot open the complainant\'s notice', (await rnotice(H1, R3.cookie, kp8!.id))!.status === 404);
    ok('the respondent sees no case record, narrative or the complainant\'s account details', up3.case.id === null
      && !/temporary test case narrative|a private address|PROBE-HM-a-|Internal: both/.test(JSON.stringify(r3)));
    ok('the respondent is notified too - without a link into the complainant\'s case', (await feed(R3.cookie)).some(f => /Your KP Form No. 9/.test(f.message) && f.caseId === null));
    ok('the respondent instructions are the summons\'s', up3.instructions.some((i: string) => /witnesses/.test(i)));

    // ── TEST 4. Acknowledgement ──
    console.log('\nTEST 4 - acknowledging receipt');
    const a1 = await rpost(H1, { action: 'acknowledge' }, R1.cookie);
    const kp8a = await prisma.caseHearingNotice.findUnique({ where: { id: kp8!.id } });
    ok('the acknowledgement is saved', a1.status === 200 && kp8a?.status === 'ACKNOWLEDGED' && kp8a.acknowledgedVia === 'RESIDENT_APP');
    const offView = (await detail(K.id)).hearings[0];
    ok('the officer sees it', offView.notices.find((x: Body) => x.id === kp8!.id)?.acknowledgedAt && offView.events.some((e: Body) => e.kind === 'notice_acknowledged' && e.by === 'Complainant (SafeComm)'));
    ok('attendance is unchanged', offView.complainantAttendance === 'NOT_RECORDED' && offView.respondentAttendance === 'NOT_RECORDED');
    ok('the officials are told it is a receipt, not attendance', await prisma.notification.count({ where: { caseId: K.id, title: { startsWith: 'Notice acknowledged' }, message: { contains: 'not attendance' } } }) >= 1);
    ok('the hearing is "acknowledged" only once both are', (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'NOTICE_ISSUED');
    ok('the respondent acknowledges the summons', (await rpost(H1, { action: 'acknowledge' }, R3.cookie)).status === 200
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.status === 'ACKNOWLEDGED');
    ok('a second acknowledgement is refused', (await rpost(H1, { action: 'acknowledge' }, R1.cookie)).status === 409);
    ok('the complainant\'s attendance reply is theirs, not the record', (await rpost(H1, { action: 'attendance', intent: 'WILL_ATTEND' }, R1.cookie)).status === 200
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.complainantAttendance === 'NOT_RECORDED');
    ok('the resident routes accept nothing else', (await rpost(H1, { action: 'complete', outcome: 'SETTLED' }, R1.cookie)).status === 400);
    ok('a party cannot change the record through the official routes', (await patch(K.id, H1, R1.cookie, { action: 'attendance', complainant: 'PRESENT' })).status === 401);

    // ── TEST 5. Rescheduling ──
    console.log('\nTEST 5 - rescheduling the mediation');
    ok('a request needs a reason', (await rpost(H1, { action: 'reschedule', reason: 'busy' }, R1.cookie)).status === 400);
    const q1 = await rpost(H1, { action: 'reschedule', reason: 'I have a medical appointment that day', preferredSchedule: 'Any morning next week' }, R1.cookie);
    const q3 = await rpost(H1, { action: 'reschedule', reason: 'I work out of town on that day' }, R3.cookie);
    ok('both parties may ask; the date does not move', q1.status === 201 && q3.status === 201
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))!.scheduledAt.getTime() === h1!.scheduledAt.getTime());
    ok('one waiting request per party', (await rpost(H1, { action: 'reschedule', reason: 'Another reason that is long enough' }, R3.cookie)).status === 409);
    ok('the request records which party asked', (await prisma.caseHearingRequest.findUnique({ where: { id: q3.body.data.id } }))?.requesterRole === 'RESPONDENT');
    await patch(K.id, H1, B.cookie, { action: 'decline_request', requestId: q1.body.data.id, note: 'Please attend; the date suits the Lupon.' });
    ok('a declined request: the complainant sees the answer, the respondent does not', mine(await resident(R1.cookie), H1)?.requests[0]?.reviewNote === 'Please attend; the date suits the Lupon.'
      && !(await feed(R3.cookie)).some(f => /not approved/.test(f.message)));
    const oldAt = h1!.scheduledAt.toISOString();
    const appr = await patch(K.id, H1, B.cookie, { action: 'reschedule', date: futureDay, time: '11:00', reason: 'At the respondent\'s request', requestId: q3.body.data.id });
    const h1r = await prisma.caseHearing.findUnique({ where: { id: H1 }, include: { notices: { orderBy: { generatedAt: 'asc' } } } });
    ok('the new date and time are saved', appr.status === 200 && h1r!.scheduledAt.toISOString() !== oldAt && h1r!.rescheduleCount === 1 && h1r!.status === 'RESCHEDULED', `${appr.status} ${appr.body.error ?? ''}`);
    const rev = await prisma.caseHearingEvent.findFirst({ where: { hearingId: H1, kind: 'rescheduled' } });
    ok('the previous schedule is kept in the history', (rev?.before as Body)?.scheduledAt === oldAt && (rev?.after as Body)?.scheduledAt === h1r!.scheduledAt.toISOString() && rev?.note === 'At the respondent\'s request');
    ok('the old notices are replaced and new KP 8 and 9 made for the new date', h1r!.notices.filter(x => x.status === 'SUPERSEDED').length === 2
      && h1r!.notices.some(x => x.noticeNumber === `KP8-${K.caseNumber}-M1-C2` && x.status === 'ISSUED' && x.scheduledAt.getTime() === h1r!.scheduledAt.getTime())
      && h1r!.notices.some(x => x.noticeNumber === `KP9-${K.caseNumber}-M1-R2` && x.status === 'ISSUED'));
    ok('both parties get the update', (await feed(R1.cookie)).some(f => /Mediation has a new date/.test(f.message)) && (await feed(R3.cookie)).some(f => /Mediation has a new date/.test(f.message)));
    ok('the respondent is told their request was approved; the complainant is not told it as theirs', (await feed(R3.cookie)).some(f => /Your request for a new date for the mediation was approved/.test(f.message))
      && !(await feed(R1.cookie)).some(f => /was approved/.test(f.message)));
    ok('the replaced notice can no longer be opened by the party', (await rnotice(H1, R1.cookie, kp8!.id))!.status === 404);

    // ── TEST 6. Mediation unsuccessful ──
    console.log('\nTEST 6 - mediation without settlement opens the Pangkat stage');
    ok('it cannot be recorded as held before its day', (await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'NOT_SETTLED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' })).status === 409);
    await arrive(H1);
    ok('no outcome without attendance', (await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'NOT_SETTLED' })).status === 400);
    ok('an outcome of another stage is refused', (await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'PANGKAT_CONSTITUTED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' })).status === 400);
    ok('attendance is recorded for each party separately', (await patch(K.id, H1, B.cookie, { action: 'attendance', complainant: 'PRESENT', respondent: 'EXCUSED' })).status === 200
      && (await prisma.caseHearing.findUnique({ where: { id: H1 } }))?.respondentAttendance === 'EXCUSED');
    ok('proceedings notes are added', (await patch(K.id, H1, B.cookie, { action: 'proceedings', note: 'The parties did not agree on the noise schedule.' })).status === 200
      && (await patch(K.id, H1, C.cookie, { action: 'proceedings', note: 'Punong Barangay explained the Pangkat procedure.' })).status === 200);
    const att = await attachPOST(req(`/api/cases/${K.id}/hearings/${H1}/attachments`, B.cookie, 'POST', { dataUrl: PNG, filename: 'attendance-sheet.png' }), PH(K.id, H1)).then(json);
    ok('an attachment is kept for the officials only', att.status === 201
      && (await attachmentGET(req(`/api/attachments/${att.body.data.id}`, B.cookie), { params: Promise.resolve({ id: att.body.data.id }) })).status === 200
      && (await attachmentGET(req(`/api/attachments/${att.body.data.id}`, R1.cookie), { params: Promise.resolve({ id: att.body.data.id }) })).status === 403);
    ok('the Pangkat cannot be recorded before its constitution is scheduled', (await pk(K.id, B.cookie, { action: 'add_member', name: 'Ana Lupon', chosenBy: 'COMPLAINANT' })).status === 409);
    const m1 = await patch(K.id, H1, B.cookie, { action: 'complete', outcome: 'NOT_SETTLED', outcomeSummary: 'The matter goes to the Pangkat ng Tagapagkasundo.',
      agreements: 'No agreement on quiet hours.', nextAction: 'Constitute the Pangkat', nextHearingDate: futureDay });
    ok('the officer records "no settlement"', m1.status === 200, `${m1.status} ${m1.body.error ?? ''}`);
    ok('the case itself is not resolved by a hearing', (await prisma.case.findUnique({ where: { id: K.id } }))?.status === 'Open');
    const d6 = await detail(K.id);
    ok('the next applicable stage is the constitution of the Pangkat', d6.next?.stage === 'CONSTITUTION' && d6.next.forms.every((f: Body) => f.formNo === 10));
    ok('the parties see the outcome they may see, not the agreements', mine(await resident(R1.cookie), H1)?.outcome?.text === 'No settlement was reached.'
      && !JSON.stringify(await resident(R3.cookie)).includes('quiet hours'));
    ok('conciliation is still refused', (await create(K.id, B.cookie, { stage: 'CONCILIATION', date: futureDay, time: '13:00' })).status === 422);
    const pc = await create(K.id, B.cookie, { stage: 'CONSTITUTION', date: futureDay, time: '13:00' });
    ok('the constitution of the Pangkat is scheduled, with the same parties', pc.status === 201 && pc.body.data.stage === 'CONSTITUTION' && pc.body.data.reference === `HRG-${K.caseNumber}-P1`
      && pc.body.data.respondentPartyId === respondent.id, `${pc.status} ${pc.body.error ?? ''}`);
    const PC = pc.body.data.id as string;
    const kp10 = await prisma.caseHearingNotice.findMany({ where: { hearingId: PC } });
    ok('KP Form No. 10 goes to both parties', kp10.length === 2 && kp10.every(x => x.formNo === 10) && new Set(kp10.map(x => x.recipientRole)).size === 2);
    const t10 = await pdfText(await rnotice(PC, R3.cookie));
    ok('the respondent opens KP 10, addressed to both parties', t10.includes('NOTICE FOR CONSTITUTION OF PANGKAT') && t10.includes('drawing lots') && t10.includes('Maria Complainanta') && t10.includes('Juan Respondente'));
    const add = (name: string, chosenBy: string) => pk(K.id, B.cookie, { action: 'add_member', name, chosenBy });
    const ma = await add('Ana Lupon', 'COMPLAINANT'), mb = await add('Ben Lupon', 'RESPONDENT'), mc = await add('Carmen Lupon', 'BOTH_PARTIES');
    ok('three Pangkat members are recorded, with how each was chosen', [ma, mb, mc].every(r => r.status === 200));
    ok('a fourth is refused', (await add('Dante Lupon', 'DRAWN_BY_LOT')).status === 409);
    const pg = (await json(await pangkatGET(req(`/api/cases/${K.id}/pangkat`, B.cookie), P(K.id)))).body.data;
    const ids3 = pg.pangkat.members.map((m: Body) => m.id) as string[];
    ok('the Pangkat cannot be recorded as constituted without its chairman and secretary', await (async () => {
      await arrive(PC);
      return (await patch(K.id, PC, B.cookie, { action: 'complete', outcome: 'PANGKAT_CONSTITUTED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' })).status === 400;
    })());
    ok('the chairman and secretary must be two different members', (await pk(K.id, B.cookie, { action: 'officers', chairmanMemberId: ids3[0], secretaryMemberId: ids3[0] })).status === 400);
    ok('the chairman and secretary are recorded', (await pk(K.id, B.cookie, { action: 'officers', chairmanMemberId: ids3[0], secretaryMemberId: ids3[2] })).status === 200);
    const k11 = []; for (const id of ids3) k11.push(await pk(K.id, B.cookie, { action: 'kp11', memberId: id }));
    const kp11 = await prisma.caseHearingNotice.findMany({ where: { hearingId: PC, formNo: 11 } });
    ok('KP Form No. 11 is made for each chosen member, for the officer to hand over', k11.every(r => r.status === 201) && kp11.length === 3
      && kp11.every(x => x.recipientRole === 'PANGKAT_MEMBER' && x.channel === 'OFFICER' && x.status === 'GENERATED' && ids3.includes(x.pangkatMemberId!)));
    ok('one KP 11 per member', (await pk(K.id, B.cookie, { action: 'kp11', memberId: ids3[0] })).status === 409);
    // Ana Lupon's own KP 11 - the notices come back in no set order.
    const anaId = (pg.pangkat.members as Body[]).find(m => m.name === 'Ana Lupon')?.id as string;
    const ana11 = kp11.find(x => x.pangkatMemberId === anaId)!;
    const t11 = await pdfText(await noticePDF(req(`/api/cases/${K.id}/hearings/${PC}/notices/${ana11.id}/pdf`, B.cookie), PN(K.id, PC, ana11.id)));
    ok('KP 11 names the member and the case', t11.includes('NOTICE TO CHOSEN PANGKAT MEMBER') && t11.includes('Ana Lupon') && t11.includes(K.caseNumber) && t11.includes('Pangkat Member'));
    ok('a party never sees the Pangkat members\' notices', !JSON.stringify(await resident(R1.cookie)).includes('Ana Lupon') && (await rnotice(PC, R1.cookie, kp11[0].id))!.status === 404);
    ok('issuing a member\'s notice through SafeComm is refused; handing it over is recorded',
      (await json(await noticePATCH(req(`/api/cases/${K.id}/hearings/${PC}/notices/${kp11[0].id}`, B.cookie, 'PATCH', { action: 'issue', method: 'SAFECOMM' }), PN(K.id, PC, kp11[0].id)))).status === 400
      && (await json(await noticePATCH(req(`/api/cases/${K.id}/hearings/${PC}/notices/${kp11[0].id}`, B.cookie, 'PATCH', { action: 'issue', method: 'IN_PERSON' }), PN(K.id, PC, kp11[0].id)))).status === 200);

    // ── TEST 7. Conciliation ──
    console.log('\nTEST 7 - with the Pangkat constituted, conciliation and KP Form No. 12');
    const con = await patch(K.id, PC, B.cookie, { action: 'complete', outcome: 'PANGKAT_CONSTITUTED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' });
    const pk7 = await prisma.casePangkat.findUnique({ where: { caseId: K.id } });
    ok('the Pangkat is recorded as constituted, with its date', con.status === 200 && pk7?.constitutedAt !== null && pk7?.constitutionHearingId === PC, `${con.status} ${con.body.error ?? ''}`);
    const cc = await create(K.id, B.cookie, { stage: 'CONCILIATION', date: futureDay, time: '15:00' });
    ok('the officer creates the conciliation schedule', cc.status === 201 && cc.body.data.stage === 'CONCILIATION' && cc.body.data.reference === `HRG-${K.caseNumber}-C1`, `${cc.status} ${cc.body.error ?? ''}`);
    const CC = cc.body.data.id as string;
    const kp12 = await prisma.caseHearingNotice.findMany({ where: { hearingId: CC } });
    ok('KP Form No. 12 is made, to both parties', kp12.length === 2 && kp12.every(x => x.formNo === 12 && x.status === 'ISSUED') && new Set(kp12.map(x => x.recipientResidentId)).size === 2);
    const c12 = mine(await resident(R1.cookie), CC), r12 = mine(await resident(R3.cookie), CC);
    ok('both parties see their notice', c12?.notices[0]?.formNo === 12 && r12?.notices[0]?.formNo === 12 && c12.notices[0].id !== r12.notices[0].id);
    const t12 = await pdfText(await rnotice(CC, R1.cookie));
    ok('KP 12 is before the Pangkat, signed by its chairman', t12.includes('(CONCILIATION PROCEEDINGS)') && t12.includes('appear before the Pangkat') && t12.includes('Pangkat Chairman') && t12.includes('Ana Lupon'));
    await arrive(CC);
    ok('a certification to file action is recorded - not generated', (await patch(K.id, CC, B.cookie, { action: 'complete', outcome: 'CERTIFICATE_TO_FILE',
      complainantAttendance: 'PRESENT', respondentAttendance: 'ABSENT', nextAction: 'Issue the certification to file action' })).status === 200
      && await prisma.caseHearingNotice.count({ where: { caseId: K.id, formNo: { notIn: [8, 9, 10, 11, 12] } } }) === 0);
    ok('the proceedings end there', (await detail(K.id)).next === null && /ended/.test((await detail(K.id)).blocked ?? ''));

    // ── TEST 8. Another resident ──
    console.log('\nTEST 8 - access to another resident\'s hearing is denied');
    ok('another resident sees none of it', !JSON.stringify(await resident(R2.cookie)).includes(K.caseNumber));
    ok('cannot act on it or open its notices', (await rpost(H1, { action: 'acknowledge' }, R2.cookie)).status === 404 && (await rpost(CC, { action: 'reschedule', reason: 'I would like another date' }, R2.cookie)).status === 404
      && (await rnotice(CC, R2.cookie))!.status === 404 && (await rnotice(CC, R2.cookie, kp12[0].id))!.status === 404);
    ok('their feed tells them nothing of it', !(await feed(R2.cookie)).some(f => f.caseNumber === K.caseNumber));

    // ── A respondent without an account ──
    console.log('\nA party without an account: an officer-managed delivery');
    const c1 = await create(K2.id, B.cookie, { date: futureDay, time: '14:00', assignedOfficialId: B2.id });
    const n1 = await prisma.caseHearingNotice.findMany({ where: { hearingId: c1.body.data?.id } });
    const n1r = n1.find(x => x.recipientRole === 'RESPONDENT')!;
    ok('the respondent\'s summons waits for an officer - nothing pretends it was delivered', c1.status === 201 && n1r.status === 'GENERATED' && n1r.channel === 'OFFICER' && n1r.recipientResidentId === null
      && n1.find(x => x.recipientRole === 'COMPLAINANT')?.status === 'ISSUED', `${c1.status} ${c1.body.error ?? ''}`);
    const C1 = c1.body.data.id as string;
    const np1 = (nid: string, body: Body) => noticePATCH(req(`/api/cases/${K2.id}/hearings/${C1}/notices/${nid}`, B.cookie, 'PATCH', body), PN(K2.id, C1, nid)).then(json);
    ok('it cannot be marked as sent through SafeComm', (await np1(n1r.id, { action: 'issue', method: 'SAFECOMM' })).status === 400);
    ok('it is served, and recorded as not delivered', (await np1(n1r.id, { action: 'issue', method: 'SERVED' })).status === 200 && (await np1(n1r.id, { action: 'delivery', delivered: false, note: 'Nobody home' })).status === 200);
    ok('the presiding officer may run it', (await patch(K2.id, C1, B2.cookie, { action: 'proceedings', note: 'Pre-hearing call.' })).status === 200);
    ok('cancelled, with the reason', (await patch(K2.id, C1, B.cookie, { action: 'cancel', reason: 'Complainant withdrew before the hearing' })).status === 200);
    const k2feed = (await feed(R1.cookie)).filter(f => f.caseId === K2.id);
    ok('the complainant is told it was cancelled - not why', k2feed.some(f => /Mediation was cancelled/.test(f.message)) && !k2feed.some(f => /withdrew/.test(f.message)));
    const c2 = await create(K2.id, B.cookie, { date: futureDay, time: '16:00' });
    ok('a cancelled proceeding may be replaced, under its own reference', c2.status === 201 && c2.body.data.reference === `HRG-${K2.caseNumber}-M1-2`, `${c2.status} ${c2.body.error ?? ''}`);
    const C2 = c2.body.data.id as string;
    const l4 = await link(K2.id, respondent2.id, C.cookie, R4.residentNumber);
    ok('linking the respondent later delivers their waiting summons to the account', l4.status === 200 && l4.body.data.noticesDelivered === 1
      && (await prisma.caseHearingNotice.findFirst({ where: { hearingId: C2, recipientRole: 'RESPONDENT', status: { not: 'SUPERSEDED' } } }))?.recipientResidentId === R4.id);
    ok('the newly linked respondent now sees it, and only their own case\'s hearings', mine(await resident(R4.cookie), C2)?.role === 'RESPONDENT' && !JSON.stringify(await resident(R4.cookie)).includes(K.caseNumber)
      && !JSON.stringify(await resident(R3.cookie)).includes(K2.caseNumber));
    ok('the cancelled mediation shows as cancelled, without the summons that was served by hand', (() => true)()
      && await resident(R4.cookie).then(d => { const h = mine(d, C1); return h?.status === 'CANCELLED' && h.notices.length === 0; }));
    const ul = await linkDELETE(req(`/api/cases/${K2.id}/parties/${respondent2.id}/account`, C.cookie, 'DELETE', { reason: 'Linked to the wrong account' }), PP(K2.id, respondent2.id)).then(json);
    ok('unlinking takes the proceeding out of that account; what was delivered stays on record', ul.status === 200 && !mine(await resident(R4.cookie), C2)
      && (await prisma.caseHearingNotice.findFirst({ where: { hearingId: C2, recipientRole: 'RESPONDENT', status: { not: 'SUPERSEDED' } } }))?.recipientResidentId === R4.id);
    await link(K2.id, respondent2.id, C.cookie, R4.residentNumber);

    // ── History ──
    console.log('\nHistory and the database');
    const kinds = (await prisma.caseHearingEvent.findMany({ where: { hearingId: H1 } })).map(e => e.kind);
    ok('every step of the mediation is in its history', ['created', 'updated', 'scheduled', 'notice_issued', 'notice_seen', 'notice_acknowledged', 'resident_intent', 'reschedule_requested',
      'request_declined', 'request_approved', 'rescheduled', 'attendance', 'proceedings_note', 'attachment_added', 'outcome'].every(x => kinds.includes(x)), kinds.join(','));
    const pkinds = (await prisma.caseHearingEvent.findMany({ where: { hearingId: PC } })).map(e => e.kind);
    ok('the Pangkat\'s members, officers, KP 11 and constitution are in the constitution\'s history', ['pangkat_member_added', 'pangkat_officers', 'notice_generated', 'pangkat_constituted'].every(x => pkinds.includes(x)));
    ok('linking an account is in the history', (await prisma.caseHearingEvent.count({ where: { hearingId: C2, kind: 'party_account_linked' } })) >= 2);
    ok('every look and change is in the access log', await prisma.reporterAccessLog.count({ where: { caseId: K.id, fields: { has: 'hearings' } } }) > 20);
    const refuse = async (f: () => Promise<unknown>) => { try { await f(); return false; } catch { return true; } };
    const ev0 = await prisma.caseHearingEvent.findFirst({ where: { hearingId: H1 } });
    ok('the database refuses to rewrite a history row', await refuse(() => prisma.caseHearingEvent.update({ where: { id: ev0!.id }, data: { note: 'rewritten' } })));
    ok('or an eligibility review', await refuse(() => prisma.caseKpReview.updateMany({ where: { caseId: K.id }, data: { decision: 'ELIGIBLE' } })));
    ok('it refuses a stage that does not exist', await refuse(() => prisma.caseHearing.create({ data: { caseId: K2.id, reference: `${TAG}-x1`, hearingNumber: 59, stage: 'HEARING_2', scheduledAt: new Date(), createdById: B.id, updatedById: B.id } })));
    ok('a KP form number outside 8-12', await refuse(() => prisma.caseHearingNotice.create({ data: { hearingId: C2, caseId: K2.id, noticeNumber: `${TAG}-x2`, formNo: 7, recipientRole: 'COMPLAINANT', recipientName: 'x', scheduledAt: new Date(), generatedById: B.id } })));
    ok('a Pangkat member\'s notice without the member', await refuse(() => prisma.caseHearingNotice.create({ data: { hearingId: C2, caseId: K2.id, noticeNumber: `${TAG}-x3`, formNo: 11, recipientRole: 'PANGKAT_MEMBER', recipientName: 'x', scheduledAt: new Date(), generatedById: B.id } })));
    ok('and a second open proceeding on a case', await refuse(() => prisma.caseHearing.create({ data: { caseId: K2.id, reference: `${TAG}-x4`, hearingNumber: 9, openKey: K2.id, scheduledAt: new Date(), createdById: B.id, updatedById: B.id } })));

    // ── The list and the calendar ──
    console.log('\nThe list and the calendar');
    const cal = async (cookie: string, qs: string) => (await json(await listGET(req(`/api/hearings?${qs}`, cookie)))).body.data;
    const ids = (d: Body) => d.rows.map((r: Body) => r.id) as string[];
    const lB = await cal(B.cookie, '');
    ok('the list holds the officer\'s proceedings, with their stage', lB.rows.filter((r: Body) => r.case.id === K.id).map((r: Body) => r.stage).sort().join() === 'CONCILIATION,CONSTITUTION,MEDIATION');
    ok('another officer sees only what they preside over', !ids(await cal(B2.cookie, '')).includes(H1) && ids(await cal(B2.cookie, '')).includes(C1));
    ok('the stage tab: mediation only', (await cal(C.cookie, `stage=MEDIATION&q=${K.caseNumber}`)).rows.map((r: Body) => r.id).join() === H1);
    ok('the stage tab: the Pangkat constitution only', (await cal(C.cookie, `stage=CONSTITUTION&q=${K.caseNumber}`)).rows.map((r: Body) => r.id).join() === PC);
    ok('day view: that day\'s, cancelled ones still traceable', ids(await cal(B.cookie, `from=${futureDay}&to=${futureDay}`)).includes(C2) && ids(await cal(B.cookie, `from=${futureDay}&to=${futureDay}`)).includes(C1));
    ok('upcoming view: still to happen only', ids(await cal(B.cookie, `from=${today}&status=scheduled,rescheduled`)).includes(C2) && !ids(await cal(B.cookie, `from=${today}&status=scheduled,rescheduled`)).includes(C1));
    ok('completed view', (await cal(C.cookie, `status=completed&q=${K.caseNumber}`)).rows.length === 3);
    ok('cancelled view', ids(await cal(C.cookie, `status=cancelled&q=${K2.caseNumber}`)).join() === C1);
    ok('rows carry what the calendar shows', (await cal(C.cookie, `q=${K.caseNumber}`)).rows.every((r: Body) => r.title && r.case.caseNumber && r.scheduledAt && 'venue' in r && 'official' in r && r.status));
    ok('a VAWC category shows nothing, even to the captain', (await cal(C.cookie, 'category=Domestic%20Violence')).rows.length === 0);
    ok('the system administrator can view but not create', (await cal(S.cookie, '')).canCreate === false);

    // ── Conflicts ──
    console.log('\nSchedule conflicts');
    const K3 = await mkCase({ assignedToId: B2.id });
    await prisma.caseParty.create({ data: { caseId: K3.id, role: 'REPORTED', fullName: 'Third Respondent', source: 'official' } });
    await eligible(K3.id, B2.id);
    const near = { date: futureDay, time: '16:30' };
    ok('more than a year ahead is refused', (await create(K3.id, B2.cookie, { ...near, date: phDay(new Date(Date.now() + 400 * 86_400_000)) })).status === 400);
    const vc = await create(K3.id, B2.cookie, near);
    ok('a venue already reserved at that time: refused, nothing saved', vc.status === 409 && vc.body.conflicts.some((c: Body) => c.kind === 'venue') && await prisma.caseHearing.count({ where: { caseId: K3.id } }) === 0);
    ok('another officer\'s hearing is described without its reference', vc.body.conflicts.every((c: Body) => c.reference === null));
    ok('an official already busy at that time: refused', (await create(K3.id, B2.cookie, { ...near, venue: 'Purok 3 covered court', assignedOfficialId: B.id })).body.conflicts?.some((c: Body) => c.kind === 'official') === true);
    const k3 = await create(K3.id, B2.cookie, { ...near, venue: 'Purok 3 covered court' });
    ok('another venue and official: scheduled', k3.status === 201, `${k3.status} ${k3.body.error ?? ''}`);
    const K3H = k3.body.data.id as string;
    const pre = await json(await conflictsGET(req(`/api/hearings/conflicts?date=${futureDay}&time=16:15&venue=barangay%20hall&officialId=${B.id}`, C.cookie)));
    ok('the live check warns before saving, with references the captain may see', pre.status === 200 && pre.body.data.conflicts.some((c: Body) => c.kind === 'official' && c.reference === c2.body.data.reference));
    const forced = await patch(K3.id, K3H, B2.cookie, { action: 'reschedule', date: futureDay, time: '16:00', venue: 'Barangay Hall', reason: 'Two rooms in the hall', confirmConflicts: true });
    const fe = await prisma.caseHearingEvent.findFirst({ where: { hearingId: K3H, kind: 'rescheduled' }, orderBy: { createdAt: 'desc' } });
    ok('going ahead knowingly is recorded with the conflict and the old schedule', forced.status === 200 && ((fe?.after as Body)?.conflictsAccepted ?? []).length > 0 && (fe?.before as Body)?.venue === 'Purok 3 covered court');
    ok('the other hearing is never moved', (await prisma.caseHearing.findUnique({ where: { id: C2 } }))!.scheduledAt.getTime() === new Date(c2.body.data.scheduledAt).getTime());

    // ── Reminders ──
    console.log('\nReminders');
    ok('the reminder schedule is configurable', parseHours('72,24', [24]).join() === '72,24' && parseHours('nonsense', [24]).join() === '24');
    process.env.CRON_SECRET = `${TAG}-secret`;
    const cron = () => cronGET(req(`/api/cron/hearing-reminders?key=${TAG}-secret`, '')).then(json);
    await prisma.caseHearing.update({ where: { id: C2 }, data: { scheduledAt: new Date(Date.now() + 3 * 3_600_000) } });
    await prisma.caseHearing.update({ where: { id: K3H }, data: { scheduledAt: new Date(Date.now() + 20 * 3_600_000) } });
    const cr = await cron(); await cron();
    ok('a hearing within a day is reminded, once', cr.status === 200 && await prisma.caseHearingEvent.count({ where: { hearingId: C2, kind: 'reminder' } }) === 1);
    ok('both parties get the reminder', (await feed(R1.cookie)).some(f => f.caseNumber === K2.caseNumber && /Reminder: mediation/.test(f.message))
      && (await feed(R4.cookie)).some(f => /Reminder: mediation/.test(f.message)));
    ok('officials are alerted once that a party\'s notice is not out', await prisma.caseHearingEvent.count({ where: { hearingId: K3H, kind: 'attention' } }) === 1
      && await prisma.caseHearingEvent.count({ where: { hearingId: C2, kind: 'attention' } }) === 0);
    await prisma.caseHearing.update({ where: { id: K3H }, data: { scheduledAt: new Date(Date.now() - 3 * 3_600_000) } });
    await cron(); await cron();
    ok('a hearing whose time passed with nothing recorded is flagged once', await prisma.caseHearingEvent.count({ where: { hearingId: K3H, kind: 'attention' } }) === 2);
    ok('the parties never see the officials\' alerts', !(await feed(R1.cookie)).some(f => /needs attention|not been issued/.test(f.message)));
    ok('without the secret, nothing runs', (await cronGET(req('/api/cron/hearing-reminders?key=wrong', '')).then(json)).status === 401);

    // ── Analytics ──
    console.log('\nAnalytics');
    const after = (await getA('hearings', C.cookie, 'scope=blotter')).body.data;
    const dd = (k: string) => after[k] - before[k];
    const st = (s: string, k: string) => after.byStage.find((x: Body) => x.stage === s)[k] - before.byStage.find((x: Body) => x.stage === s)[k];
    // Mediation, constitution and conciliation on K; C1 (cancelled) and C2 on K2; K3's (past its time).
    ok('totals move with the records', dd('totalScheduled') === 6 && dd('completed') === 3 && dd('cancelled') === 1 && dd('rescheduled') === 2 && dd('upcomingCount') === 1,
      JSON.stringify({ t: dd('totalScheduled'), c: dd('completed'), x: dd('cancelled'), r: dd('rescheduled'), u: dd('upcomingCount') }));
    ok('by stage', st('MEDIATION', 'completed') === 1 && st('CONSTITUTION', 'completed') === 1 && st('CONCILIATION', 'completed') === 1 && st('MEDIATION', 'cancelled') === 1 && st('MEDIATION', 'total') === 4);
    ok('the VAWC board counts no hearings', (await getA('hearings', V.cookie, 'scope=vawc')).body.data.applicable === false);

    // ── Hearing Management lists the blotter cases, scheduled or not ──
    console.log('\nHearing Management case list - from an unassigned case to the residents\' accounts');
    const list = async (cookie: string, qs: string) => (await json(await candidatesGET(req(`/api/hearings/cases?${qs}`, cookie)))).body.data as Body;
    const mineQ = `q=${TAG}-${process.pid}&pageSize=100`;
    const KU = await mkCase({ assignedToId: null });
    const R5 = await mkRes('e', 'Rosa', 'Kapitbahay');
    const all = await list(B.cookie, mineQ);
    const row = (id: string, data: Body = all) => data.rows.find((r: Body) => r.id === id);
    ok('an unassigned case with no hearing is listed to a blotter officer - not only cases with hearings or assigned to them',
      row(KU.id)?.hearing.state === 'NOT_SCHEDULED' && row(KU.id).canClaim === true && row(KU.id).canManage === false && row(KU.id).respondents.length === 0);
    ok('a case nobody has reviewed shows as pending review, with why - never assumed eligible', row(KU.id).eligibility.state === 'PENDING_REVIEW'
      && row(KU.id).eligibility.reasons.some((r: string) => /category/i.test(r)));
    ok('a reviewed case shows as eligible; one with a proceeding open says so', row(K2.id)?.eligibility.state === 'ELIGIBLE' && row(K2.id).hearing.state === 'IN_PROGRESS' && row(K2.id).hearing.latest?.id === C2);
    ok('a VAWC case is never listed', !row(KV.id) && all.rows.every((r: Body) => r.caseType !== 'Domestic Violence'));
    const asB2 = await list(B2.cookie, mineQ);
    ok('another officer sees the case, and who manages it, but cannot manage it', row(KU.id, asB2)?.canClaim === true && row(K2.id, asB2)?.canManage === false
      && row(K2.id, asB2)?.assignedTo?.name === `${TAG} blotter`);
    ok('search by respondent', (await list(B.cookie, 'q=Pedro Neighbore')).rows.some((r: Body) => r.id === K2.id));
    ok('search by complainant', (await list(B.cookie, `q=Complainanta&pageSize=100`)).rows.some((r: Body) => r.id === KU.id));
    const pend = await list(B.cookie, `${mineQ}&eligibility=PENDING_REVIEW`);
    ok('filter by KP eligibility', pend.rows.length > 0 && pend.rows.every((r: Body) => r.eligibility.state === 'PENDING_REVIEW') && !row(K2.id, pend));
    const none = await list(B.cookie, `${mineQ}&hearing=NOT_SCHEDULED`);
    ok('filter by hearing status', Boolean(row(KU.id, none)) && !row(K2.id, none));
    const one = await list(B.cookie, `q=${TAG}-${process.pid}&pageSize=1&page=2`);
    ok('paginated', one.rows.length === 1 && one.page === 2 && one.total >= 4 && one.pages === one.total);
    ok('a resident cannot read the case list', (await json(await candidatesGET(req('/api/hearings/cases', R1.cookie)))).status === 401);

    const u1 = await create(KU.id, B.cookie, { date: futureDay, time: '13:00' });
    ok('an unassigned case: refused until the officer takes it - and they are told they can', u1.status === 403 && u1.body.canClaim === true);
    ok('taking it', (await json(await claimPOST(req(`/api/cases/${KU.id}/claim`, B.cookie, 'POST', {}), P(KU.id)))).status === 200);
    ok('then refused until the category is confirmed', (await create(KU.id, B.cookie, { date: futureDay, time: '13:00' })).body.error?.includes('category'));
    const conf = await json(await classPATCH(req(`/api/cases/${KU.id}/classification`, B.cookie, 'PATCH', { caseType: 'Noise Complaint', confirm: true }), { params: Promise.resolve({ id: KU.id }) }));
    ok('confirming the category', conf.status === 200, `${conf.status} ${conf.body.error ?? ''}`);
    ok('then refused until the eligibility review', /review/i.test((await create(KU.id, B.cookie, { date: futureDay, time: '13:00' })).body.error ?? ''));
    ok('the review', (await json(await kpPOST(req(`/api/cases/${KU.id}/kp-review`, B.cookie, 'POST', { answers: allYes, approve: true }), P(KU.id)))).status === 201);
    ok('the list now shows it eligible, with mediation next', row(KU.id, await list(B.cookie, mineQ))?.eligibility.state === 'ELIGIBLE' && row(KU.id, await list(B.cookie, mineQ)).next?.stage === 'MEDIATION');
    const noResp = await create(KU.id, B.cookie, { date: futureDay, time: '13:00' });
    ok('scheduling without a respondent on record: refused, and why', noResp.status === 400 && /respondent/i.test(noResp.body.error ?? ''));
    const rp = await json(await recordsPUT(req(`/api/cases/${KU.id}/records`, B.cookie, 'PUT', { role: 'REPORTED', party: { fullName: 'Rosa Kapitbahay', age: '41' } }), P(KU.id)));
    ok('recording the respondent on the case', rp.status === 200, `${rp.status} ${rp.body.error ?? ''}`);
    const ru = await prisma.caseParty.findFirst({ where: { caseId: KU.id, role: 'REPORTED' } });
    ok('linking the respondent\'s account by resident number', (await link(KU.id, ru!.id, B.cookie, R5.residentNumber)).status === 200);
    const made = await create(KU.id, B.cookie, { stage: 'MEDIATION', date: futureDay, time: '13:00', venue: 'Barangay Hall', residentInstructions: 'Bring the receipts.' });
    ok('the mediation is saved', made.status === 201, `${made.status} ${made.body.error ?? ''}`);
    const KUH = made.body.data.id as string;
    const saved = await prisma.caseHearing.findUnique({ where: { id: KUH }, include: { notices: true } });
    ok('saved with the case ID and the case\'s own party records - never a typed name', saved?.caseId === KU.id && saved.respondentPartyId === ru!.id && saved.complainantPartyId === null
      && saved.stage === 'MEDIATION' && saved.status === 'NOTICE_ISSUED');
    const n8 = saved!.notices.find(x => x.formNo === 8); const n9 = saved!.notices.find(x => x.formNo === 9);
    ok('KP Form No. 8 to the complainant\'s account and No. 9 to the respondent\'s, for the one schedule', saved!.notices.length === 2
      && n8?.recipientRole === 'COMPLAINANT' && n8.recipientResidentId === R1.id && n8.channel === 'SAFECOMM_ACCOUNT' && n8.status === 'ISSUED'
      && n9?.recipientRole === 'RESPONDENT' && n9.recipientResidentId === R5.id && n9.channel === 'SAFECOMM_ACCOUNT'
      && n8.scheduledAt.getTime() === saved!.scheduledAt.getTime() && n9.scheduledAt.getTime() === saved!.scheduledAt.getTime());
    ok('a second press does not make a second mediation', (await create(KU.id, B.cookie, { stage: 'MEDIATION', date: futureDay, time: '13:00' })).status === 422
      && await prisma.caseHearing.count({ where: { caseId: KU.id } }) === 1);
    ok('the case list shows the proceeding open', row(KU.id, await list(B.cookie, mineQ))?.hearing.latest?.id === KUH);
    const ku1 = (await resident(R1.cookie)).upcoming.find((h: Body) => h.id === KUH);
    ok('the complainant sees it at once, with KP Form No. 8, the instructions and the issuing official', ku1?.case.caseNumber === KU.caseNumber && ku1.notices.length === 1 && ku1.notices[0].formNo === 8
      && ku1.instructions.some((i: string) => i.includes('receipts')) && ku1.notices[0].issuedBy === `${TAG} blotter`);
    const ku5 = (await resident(R5.cookie)).upcoming.find((h: Body) => h.id === KUH);
    ok('the respondent sees the same schedule, with KP Form No. 9 only, and no case record', ku5?.scheduledAt === ku1?.scheduledAt && ku5.notices.length === 1 && ku5.notices[0].formNo === 9
      && ku5.role === 'RESPONDENT' && ku5.case.id === null);
    ok('the respondent\'s KP Form No. 9 opens', (await rnotice(KUH, R5.cookie))!.status === 200 && (await rnotice(KUH, R5.cookie, n8!.id))!.status === 404);
    ok('both are told in their notifications', (await feed(R1.cookie)).some(f => /KP Form No\. 8/.test(f.message)) && (await feed(R5.cookie)).some(f => /KP Form No\. 9/.test(f.message)));
    ok('an unrelated resident sees none of it', !(await resident(R2.cookie)).upcoming.some((h: Body) => h.id === KUH) && (await rnotice(KUH, R2.cookie))!.status === 404);
    ok('a resident cannot change the hearing', (await json(await hearingPATCH(req(`/api/cases/${KU.id}/hearings/${KUH}`, R5.cookie, 'PATCH', { action: 'cancel', reason: 'I do not want to go' }), PH(KU.id, KUH)))).status === 401
      && (await rpost(KUH, { action: 'attendance', intent: 'WILL_ATTEND' }, R5.cookie)).status !== 200);
    ok('the respondent acknowledges; attendance stays unrecorded', (await rpost(KUH, { action: 'acknowledge' }, R5.cookie)).status === 200
      && (await prisma.caseHearingNotice.findUnique({ where: { id: n9!.id } }))?.status === 'ACKNOWLEDGED'
      && (await prisma.caseHearing.findUnique({ where: { id: KUH } }))?.respondentAttendance === 'NOT_RECORDED');
    const moved = await patch(KU.id, KUH, B.cookie, { action: 'reschedule', date: futureDay, time: '15:30', reason: 'The hall is in use that morning' });
    const kuEv = await prisma.caseHearingEvent.findFirst({ where: { hearingId: KUH, kind: 'rescheduled' } });
    ok('rescheduled: the old schedule kept in the history', moved.status === 200 && (kuEv?.before as Body)?.scheduledAt === saved!.scheduledAt.toISOString());
    ok('both residents see the new time', (await resident(R5.cookie)).upcoming.find((h: Body) => h.id === KUH)?.scheduledAt !== ku5?.scheduledAt
      && (await resident(R1.cookie)).upcoming.find((h: Body) => h.id === KUH)?.scheduledAt === (await resident(R5.cookie)).upcoming.find((h: Body) => h.id === KUH)?.scheduledAt);
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
    && await prisma.casePangkat.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.hm.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
