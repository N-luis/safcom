/**
 * VAWC hearings on the shared hearing workflow (CaseHearing), through the
 * real routes and the real database, in-process (no dev server).
 * Run with:  npm run test:vawchearings
 *
 * Covers: VAWC hearing types (never mediation or conciliation), a VAWC
 * official creating and running a hearing exactly as the blotter desk does,
 * the VAWC Notice of Hearing (not a KP form), who may reach VAWC hearings
 * (server-side), the resident page with both case types, the respondent's
 * payload, and reclassifying a case with hearings. The blotter workflow
 * itself is tests/hearings.test.ts (unchanged except its VAWC lines).
 *
 * Needs prisma/sql/022 applied. Temporary rows are marked PROBE-VH and
 * removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import {
  KP_STAGES, VAWC_HEARING_TYPES, VAWC_HEARING_TYPE_KEYS, HEARING_TYPES, KP_KEYS, outcomesFor, partyFormsFor, nextStep, stageLabel, residentHearingMessage, phDay,
} from '../lib/hearings';
import { notificationsVisibleTo } from '../lib/caseAccess';
import { vawcNoticeBody } from '../lib/vawcNoticePdf';
import { GET as caseHearingsGET, POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { PATCH as hearingPATCH } from '../app/api/cases/[id]/hearings/[hid]/route';
import { GET as noticePreview, POST as noticePOST } from '../app/api/cases/[id]/hearings/[hid]/notices/route';
import { GET as noticePDF } from '../app/api/cases/[id]/hearings/[hid]/notices/[nid]/pdf/route';
import { POST as pangkatPOST } from '../app/api/cases/[id]/pangkat/route';
import { POST as kpPOST } from '../app/api/cases/[id]/kp-review/route';
import { GET as listGET } from '../app/api/hearings/route';
import { GET as candidatesGET } from '../app/api/hearings/cases/route';
import { PATCH as classPATCH } from '../app/api/cases/[id]/classification/route';
import { GET as residentGET } from '../app/api/resident/hearings/route';
import { POST as residentPOST } from '../app/api/resident/hearings/[hid]/route';
import { GET as residentNotice } from '../app/api/resident/hearings/[hid]/notice/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-VH';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
async function pdfText(res: Response | undefined) {
  const bytes = new Uint8Array(await res!.arrayBuffer());
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
  return out.replace(/\s+/g, ' ');
}
const allYes = Object.fromEntries(KP_KEYS.map(k => [k, 'YES']));

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── 1. The rules ──
    console.log('\n1. VAWC hearing types and labels');
    const vawcLabels = VAWC_HEARING_TYPE_KEYS.map(k => `${VAWC_HEARING_TYPES[k].label} ${VAWC_HEARING_TYPES[k].short} ${VAWC_HEARING_TYPES[k].resident}`).join(' ');
    ok('no VAWC hearing type says mediation, conciliation or settlement', !/mediat|concilia|settle|pangkat|lupon/i.test(vawcLabels), vawcLabels);
    ok('the hearing types are keyed by case type, and the blotter stages are unchanged', HEARING_TYPES.BLOTTER === KP_STAGES
      && KP_STAGES.MEDIATION.label === 'Mediation before the Punong Barangay' && KP_STAGES.CONSTITUTION.label === 'Constitution of the Pangkat'
      && KP_STAGES.CONCILIATION.label === 'Conciliation before the Pangkat' && Object.keys(HEARING_TYPES.VAWC).join() === VAWC_HEARING_TYPE_KEYS.join());
    ok('a VAWC hearing never offers a settlement, a certification to file action or a withdrawal', VAWC_HEARING_TYPE_KEYS.every(k =>
      !outcomesFor(k).some(o => ['SETTLED', 'NOT_SETTLED', 'CERTIFICATE_TO_FILE', 'WITHDRAWN', 'PANGKAT_CONSTITUTED', 'CONTINUED'].includes(o))));
    ok('a VAWC notice is no KP form; only the desk hearing calls the respondent', partyFormsFor('VAWC_DESK_HEARING').map(f => `${f.formNo}${f.recipientRole[0]}`).join() === 'nullC,nullR'
      && partyFormsFor('VICTIM_INTERVIEW').map(f => f.recipientRole).join() === 'COMPLAINANT' && partyFormsFor('MEDIATION').map(f => f.formNo).join() === '8,9');
    ok('a VAWC case never gets a KP stage; a blotter case never gets a VAWC type', nextStep('Domestic Violence', [], false, 'MEDIATION').stage === null
      && nextStep('Noise Complaint', [], false, 'CASE_CONFERENCE').stage === null && nextStep('Domestic Violence', [], false, 'CASE_CONFERENCE').stage === 'CASE_CONFERENCE'
      && nextStep('Noise Complaint', [], false).stage === 'MEDIATION');
    ok('a resident is told about a VAWC hearing in neutral words', /^Hearing at the barangay is scheduled/.test(residentHearingMessage({ kind: 'scheduled',
      after: { hearingNumber: 1, stage: 'VAWC_DESK_HEARING', session: 1, scheduledAt: new Date().toISOString() } }) ?? ''));
    ok('the VAWC notice text: not mediation, confidential, no KP warning', vawcNoticeBody({ hearingType: 'VAWC_DESK_HEARING', scheduledAt: new Date(), venue: null, recipientRole: 'RESPONDENT' })
      .join(' ').match(/not a mediation or conciliation proceeding.*confidential/) !== null
      && !/counterclaim|contempt|FAIL NOT/i.test(vawcNoticeBody({ hearingType: 'VAWC_DESK_HEARING', scheduledAt: new Date(), venue: null, recipientRole: 'RESPONDENT' }).join(' ')));

    // ── People and cases ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.vh.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const V = await mk('vawc', 'vawc_officer');
    const V2 = await mk('vawc2', 'vawc_officer');
    const C = await mk('captain', 'admin');
    const S = await mk('sysadmin', 'system_admin');
    const mkRes = async (k: string, first: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: first, lastName: 'Fictional', age: 31, gender: 'Female',
        barangay: 'Ayukit', address: `${k} Confidential Address St`, contactNumber: `0917555${String(process.pid % 10000).padStart(4, '0')}`, emailVerified: true } });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const R1 = await mkRes('a', 'Ana');      // files every case here: the complainant
    const R2 = await mkRes('b', 'Bea');      // a party to nothing here
    let n = 0;
    const NARRATIVE = 'SECRET-NARRATIVE fictional account of the incident';
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Ana Fictional', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: NARRATIVE, status: 'Open', riskLevel: 'Low', residentId: R1.id, assignedToId: B.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const eligible = async (caseId: string) => {
      await prisma.assessmentHistory.create({ data: { caseId, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
      await prisma.caseKpReview.create({ data: { caseId, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: allYes, reviewedById: B.id, version: 2, approvedById: B.id, approvedAt: new Date() } });
    };
    const KV = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });
    await prisma.caseParty.create({ data: { caseId: KV.id, role: 'REPORTED', fullName: 'Fictional Respondent', address: '9 Hidden Street', source: 'reporter' } });
    await prisma.caseParty.create({ data: { caseId: KV.id, role: 'AFFECTED', fullName: 'Ana Fictional', address: 'AFFECTED-ADDRESS 1 Safe House', contactNumber: '09170000001', source: 'reporter' } });
    const KB = await mkCase({});
    await prisma.caseParty.create({ data: { caseId: KB.id, role: 'REPORTED', fullName: 'Fictional Neighbor', source: 'official' } });
    await eligible(KB.id);
    const KR = await mkCase({});
    await prisma.caseParty.create({ data: { caseId: KR.id, role: 'REPORTED', fullName: 'Fictional Partner', source: 'official' } });
    await eligible(KR.id);

    const P = (id: string) => ({ params: Promise.resolve({ id }) });
    const PH = (id: string, hid: string) => ({ params: Promise.resolve({ id, hid }) });
    const create = (caseId: string, cookie: string, body: Body) => caseHearingsPOST(req(`/api/cases/${caseId}/hearings`, cookie, 'POST', body), P(caseId)).then(json);
    const patch = (caseId: string, hid: string, cookie: string, body: Body) => hearingPATCH(req(`/api/cases/${caseId}/hearings/${hid}`, cookie, 'PATCH', body), PH(caseId, hid)).then(json);
    const detail = (caseId: string, cookie: string) => caseHearingsGET(req(`/api/cases/${caseId}/hearings`, cookie), P(caseId)).then(json);
    const list = (cookie: string, q = '') => listGET(req(`/api/hearings?${q}`, cookie)).then(json);
    const resident = async (cookie: string) => (await json(await residentGET(req('/api/resident/hearings', cookie)))).body;
    const rpost = (hid: string, body: Body, cookie: string) => residentPOST(req(`/api/resident/hearings/${hid}`, cookie, 'POST', body), { params: Promise.resolve({ hid }) }).then(json);
    const future = new Date(Date.now() + 6 * 86_400_000);
    const futureDay = phDay(future);
    const arrive = (hid: string) => prisma.caseHearing.update({ where: { id: hid }, data: { scheduledAt: new Date(Date.now() - 2 * 60_000) } });

    // ── 2. A VAWC official creates a hearing ──
    console.log('\n2. A report classified VAWC: the VAWC desk lists it and creates a hearing');
    const cands = await json(await candidatesGET(req('/api/hearings/cases?track=VAWC&pageSize=100', V.cookie)));
    ok('the VAWC case is on the VAWC desk\'s case list, managed by its officer', cands.status === 200 && cands.body.data.rows.some((r: Body) => r.id === KV.id && r.canManage)
      && cands.body.data.rows.every((r: Body) => r.caseType !== 'Noise Complaint'));
    ok('the blotter desk cannot ask for the VAWC case list (403)', (await json(await candidatesGET(req('/api/hearings/cases?track=VAWC', B.cookie)))).status === 403);
    ok('the VAWC desk\'s default list is VAWC cases', (await json(await candidatesGET(req('/api/hearings/cases?pageSize=100', V.cookie)))).body.data.track === 'VAWC');
    const d0 = await detail(KV.id, V.cookie);
    ok('the case\'s hearings: no KP review, every VAWC type offered, the desk\'s officials', d0.status === 200 && d0.body.data.track === 'VAWC' && d0.body.data.eligibility.eligible
      && d0.body.data.choices.map((c: Body) => c.stage).join() === VAWC_HEARING_TYPE_KEYS.join() && d0.body.data.pangkat === null
      && d0.body.data.officials.every((o: Body) => ['vawc_officer', 'vawc', 'vawc_lead', 'admin'].includes(o.role)));
    ok('a KP stage on a VAWC case is refused (RA 9262)', (await create(KV.id, V.cookie, { stage: 'MEDIATION', date: futureDay, time: '09:00' })).status === 422);
    ok('no KP review or Pangkat may be recorded on it', (await json(await kpPOST(req(`/api/cases/${KV.id}/kp-review`, C.cookie, 'POST', { answers: allYes, approve: true }), P(KV.id)))).status === 422
      && (await json(await pangkatPOST(req(`/api/cases/${KV.id}/pangkat`, C.cookie, 'POST', { action: 'add_member', name: 'Fictional Lupon', chosenBy: 'BOTH_PARTIES' }), P(KV.id)))).status === 422);
    ok('another VAWC officer, not assigned, may not create one (403)', (await create(KV.id, V2.cookie, { stage: 'VAWC_DESK_HEARING', date: futureDay, time: '09:00' })).status === 403);
    const c1 = await create(KV.id, V.cookie, { stage: 'VAWC_DESK_HEARING', date: futureDay, time: '10:00', venue: 'Barangay Hall, Room 2' });
    ok('the assigned VAWC officer schedules a VAWC Desk Hearing (201)', c1.status === 201, `${c1.status} ${c1.body.error ?? ''}`);
    const H1 = c1.body.data as Body;
    const n1 = await prisma.caseHearingNotice.findMany({ where: { hearingId: H1.id }, orderBy: { recipientRole: 'asc' } });
    ok('same workflow: scheduled with a notice to each party - the VAWC Notice of Hearing, no KP form', H1.stage === 'VAWC_DESK_HEARING' && /^HRG-.*-V1$/.test(H1.reference)
      && n1.length === 2 && n1.every(x => x.formNo === null && x.noticeNumber.startsWith('NH-'))
      && n1.find(x => x.recipientRole === 'COMPLAINANT')?.status === 'ISSUED' && n1.find(x => x.recipientRole === 'RESPONDENT')?.status === 'GENERATED');
    ok('its status follows the notices, as on the blotter desk', (await prisma.caseHearing.findUnique({ where: { id: H1.id } }))?.status === 'NOTICE_ISSUED');
    const pv = await noticePreview(req(`/api/cases/${KV.id}/hearings/${H1.id}/notices?recipient=RESPONDENT`, V.cookie), PH(KV.id, H1.id));
    const pvText = await pdfText(pv);
    ok('the respondent\'s notice: VAWC Notice of Hearing, not a KP form, no complainant address or contact', pv.status === 200 && /NOTICE OF HEARING/.test(pvText)
      && /BARANGAY VAWC DESK/.test(pvText) && /VAWC Desk Hearing/.test(pvText) && !/KP Form No|SUMMONS|S U M M O N S/.test(pvText)
      && !/Confidential Address|AFFECTED-ADDRESS|0917555|09170000001|SECRET-NARRATIVE/.test(pvText), pvText.slice(0, 200));
    const rn = n1.find(x => x.recipientRole === 'RESPONDENT')!;
    ok('the stored respondent notice prints the same way', (await noticePDF(req(`/api/cases/${KV.id}/hearings/${H1.id}/notices/${rn.id}/pdf`, C.cookie),
      { params: Promise.resolve({ id: KV.id, hid: H1.id, nid: rn.id }) })).status === 200);

    // ── 3. Who may reach VAWC hearings ──
    console.log('\n3. Who may reach VAWC hearings (server-side)');
    ok('a blotter officer: the VAWC case\'s hearings are not found (404 - its existence is not confirmed)', (await detail(KV.id, B.cookie)).status === 404
      && (await create(KV.id, B.cookie, { stage: 'VAWC_DESK_HEARING', date: futureDay, time: '11:00' })).status === 404
      && (await patch(KV.id, H1.id, B.cookie, { action: 'proceedings', note: 'probe' })).status === 404);
    ok('a blotter officer asking for the VAWC hearing list: 403', (await list(B.cookie, 'track=VAWC')).status === 403 && (await list(B.cookie, 'track=ALL')).body.data?.rows.every((r: Body) => r.track === 'BLOTTER'));
    ok('the system administrator: no VAWC hearings (403 on the list, 404 on the case)', (await list(S.cookie, 'track=VAWC')).status === 403 && (await detail(KV.id, S.cookie)).status === 404);
    ok('the blotter desk\'s calendar never shows the VAWC hearing', !(await list(B.cookie)).body.data.rows.some((r: Body) => r.id === H1.id)
      && !(await list(C.cookie)).body.data.rows.some((r: Body) => r.id === H1.id));
    const vl = await list(V.cookie);
    ok('the VAWC desk\'s list and calendar show it, with its case type', vl.status === 200 && vl.body.data.rows.some((r: Body) => r.id === H1.id && r.track === 'VAWC'));
    const both = await list(C.cookie, 'track=ALL');
    ok('the captain may see both case types, each marked', both.status === 200 && both.body.data.tracks.join() === 'BLOTTER,VAWC' && both.body.data.rows.some((r: Body) => r.id === H1.id && r.track === 'VAWC'));

    // ── 4. Blotter alongside ──
    const cb = await create(KB.id, B.cookie, { date: futureDay, time: '14:00' });
    ok('a blotter mediation is created exactly as before (KP 8 and KP 9)', cb.status === 201 && cb.body.data.stage === 'MEDIATION'
      && (await prisma.caseHearingNotice.findMany({ where: { hearingId: cb.body.data.id } })).map(x => x.formNo).sort().join() === '8,9');
    const HB = cb.body.data as Body;

    // ── 5. The resident ──
    console.log('\n5. My Hearings & Notices: both case types');
    const r1 = await resident(R1.cookie);
    const all1 = (r1.data.history as Body[]).flatMap(g => g.hearings);
    ok('both hearings are listed, each with its case type', all1.some(h => h.id === H1.id && h.caseType === 'VAWC') && all1.some(h => h.id === HB.id && h.caseType === 'BLOTTER'));
    ok('upcoming counts both', r1.data.upcoming.some((h: Body) => h.id === H1.id) && r1.data.upcoming.some((h: Body) => h.id === HB.id));
    ok('the history groups carry the badge', (r1.data.history as Body[]).some(g => g.caseType === 'VAWC') && (r1.data.history as Body[]).some(g => g.caseType === 'BLOTTER'));
    const mineV = all1.find(h => h.id === H1.id)!;
    ok('the VAWC hearing reads in neutral words, with VAWC instructions (no KP rules)', mineV.title === 'Hearing at the barangay' && mineV.stageLabel === 'VAWC Desk Hearing'
      && mineV.roleLabel === 'Complainant' && !mineV.instructions.join(' ').match(/Katarungang|counterclaim|summons/i) && /confidential/i.test(mineV.instructions.join(' ')));
    const payload = JSON.stringify(r1);
    ok('the resident API carries no address, contact number or narrative of anyone', !/Confidential Address|AFFECTED-ADDRESS|9 Hidden Street|0917555|09170000001|SECRET-NARRATIVE/.test(payload)
      && !/"(address|contactNumber|description|narrative)"/.test(payload));
    ok('another resident sees none of it', !(await resident(R2.cookie)).data.history.length);
    ok('...and cannot act on it or open its notice (404)', (await rpost(H1.id, { action: 'acknowledge' }, R2.cookie)).status === 404
      && (await residentNotice(req(`/api/resident/hearings/${H1.id}/notice`, R2.cookie), { params: Promise.resolve({ hid: H1.id }) })).status === 404);
    const myNotice = await residentNotice(req(`/api/resident/hearings/${H1.id}/notice`, R1.cookie), { params: Promise.resolve({ hid: H1.id }) });
    const myText = await pdfText(myNotice);
    ok('the complainant opens their VAWC notice (not a KP form)', myNotice.status === 200 && /NOTICE OF HEARING/.test(myText) && !/KP Form No/.test(myText));
    ok('the complainant acknowledges it - the hearing reads acknowledged', (await rpost(H1.id, { action: 'acknowledge' }, R1.cookie)).status === 200
      && (await prisma.caseHearing.findUnique({ where: { id: H1.id } }))?.status === 'ACKNOWLEDGED');
    const rq = await rpost(H1.id, { action: 'reschedule', reason: 'Fictional: I have a clinic appointment that day', preferredSchedule: 'Any morning next week' }, R1.cookie);
    ok('and asks for a new date (201)', rq.status === 201);
    const told = await prisma.notification.findMany({ where: { caseId: KV.id, title: { startsWith: 'New date requested' } } });
    const visV = await prisma.notification.count({ where: { AND: [{ id: { in: told.map(t => t.id) } }, notificationsVisibleTo({ userId: V.id, role: 'vawc_officer' })] } });
    const visB = await prisma.notification.count({ where: { AND: [{ id: { in: told.map(t => t.id) } }, notificationsVisibleTo({ userId: B.id, role: 'officer' })] } });
    ok('the request goes to the VAWC officials - never the blotter desk', told.length > 0 && visV > 0 && visB === 0);

    // ── 6. The VAWC official handles it, and records the outcome ──
    console.log('\n6. The VAWC official handles the request and records the outcome');
    const reqRow = await prisma.caseHearingRequest.findFirst({ where: { hearingId: H1.id, status: 'PENDING' } });
    const newDay = phDay(new Date(Date.now() + 8 * 86_400_000));
    const ap = await patch(KV.id, H1.id, V.cookie, { action: 'reschedule', date: newDay, time: '10:00', reason: 'At the complainant\'s request', requestId: reqRow?.id });
    const after = await prisma.caseHearing.findUnique({ where: { id: H1.id }, include: { notices: true, requests: true } });
    ok('approved with a new date: old notices replaced, new VAWC notices made', ap.status === 200 && after?.status === 'RESCHEDULED' && after.requests[0].status === 'APPROVED'
      && after.notices.filter(x => x.status === 'SUPERSEDED').length === 2 && after.notices.filter(x => x.status !== 'SUPERSEDED').every(x => x.formNo === null));
    const msgs = (await resident(R1.cookie)).data.history.flatMap((g: Body) => g.hearings).find((h: Body) => h.id === H1.id).updates.map((u: Body) => u.message).join(' | ');
    ok('the resident is told, in neutral words', /request for a new date for the hearing at the barangay was approved/i.test(msgs) && !/VAWC|violence|abuse/i.test(msgs), msgs);
    await arrive(H1.id);
    ok('"Amicable settlement" is refused on a VAWC hearing', (await patch(KV.id, H1.id, V.cookie, { action: 'complete', outcome: 'SETTLED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' })).status === 400);
    ok('attendance of both parties is required, as on the blotter desk', (await patch(KV.id, H1.id, V.cookie, { action: 'complete', outcome: 'HELD', complainantAttendance: 'PRESENT' })).status === 400);
    const done = await patch(KV.id, H1.id, V.cookie, { action: 'complete', outcome: 'HELD', complainantAttendance: 'PRESENT', respondentAttendance: 'ABSENT', nextAction: 'Fictional: refer to the MSWDO' });
    ok('the outcome is recorded (held)', done.status === 200 && (await prisma.caseHearing.findUnique({ where: { id: H1.id } }))?.status === 'COMPLETED');

    // ── 7. A complainant-only hearing type ──
    console.log('\n7. A hearing with the complainant only');
    const c2 = await create(KV.id, V.cookie, { stage: 'VICTIM_INTERVIEW', date: futureDay, time: '15:00', respondentPartyId: (await prisma.caseParty.findFirst({ where: { caseId: KV.id, role: 'REPORTED' } }))!.id });
    const H2 = c2.body.data as Body;
    const n2 = c2.status === 201 ? await prisma.caseHearingNotice.findMany({ where: { hearingId: H2.id } }) : [];
    ok('an interview names no respondent and notifies the complainant only', c2.status === 201 && H2.respondentPartyId === null && n2.length === 1 && n2[0].recipientRole === 'COMPLAINANT',
      `${c2.status} ${c2.body.error ?? ''}`);
    ok('no notice can be made for the respondent', (await json(await noticePOST(req(`/api/cases/${KV.id}/hearings/${H2.id}/notices`, V.cookie, 'POST', { recipient: 'RESPONDENT' }), PH(KV.id, H2.id)))).status === 400);
    await arrive(H2.id);
    ok('it is recorded with the complainant\'s attendance alone', (await patch(KV.id, H2.id, V.cookie, { action: 'complete', outcome: 'HELD', complainantAttendance: 'PRESENT' })).status === 200);

    // ── 8. Reclassification ──
    console.log('\n8. A case moved between desks with a hearing on it');
    const cr = await create(KR.id, B.cookie, { date: futureDay, time: '16:00' });
    const HR = cr.body.data as Body;
    const kp8 = await prisma.caseHearingNotice.findFirst({ where: { hearingId: HR.id, recipientRole: 'COMPLAINANT' } });
    const rc = await json(await classPATCH(req(`/api/cases/${KR.id}/classification`, B.cookie, 'PATCH', { caseType: 'Domestic Violence', reason: 'Fictional: the respondent is her partner' }), P(KR.id)));
    const hr = await prisma.caseHearing.findUnique({ where: { id: HR.id }, include: { events: true, notices: true } });
    ok('reclassified to VAWC: the open mediation is cancelled, with the reason, in its history', rc.status === 200 && rc.body.data?.hearingsCancelled === 1 && hr?.status === 'CANCELLED'
      && hr.events.some(e => e.kind === 'cancelled' && (e.after as Body)?.reclassified === true) && /reclassified/.test(hr.statusReason ?? ''), JSON.stringify(rc.body).slice(0, 200));
    ok('notices already issued stay issued (not regenerated)', hr?.notices.find(x => x.id === kp8?.id)?.status === kp8?.status && hr?.notices.length === 2);
    ok('the change is in the audit trail', await prisma.assessmentHistory.count({ where: { caseId: KR.id, kind: 'category_change' } }) === 1
      && await prisma.activity.count({ where: { caseId: KR.id, type: 'hearing', message: { contains: 'reclassified' } } }) === 1);
    ok('access follows at once: the blotter desk no longer finds it', (await detail(KR.id, B.cookie)).status === 404 && (await detail(KR.id, C.cookie)).status === 200
      && !(await list(B.cookie)).body.data.rows.some((r: Body) => r.id === HR.id));
    const cv = await create(KR.id, C.cookie, { stage: 'CASE_CONFERENCE', date: futureDay, time: '08:30' });
    ok('a new hearing on it uses the VAWC type and notice', cv.status === 201 && (await prisma.caseHearingNotice.findMany({ where: { hearingId: cv.body.data.id } })).every(x => x.formNo === null && x.noticeNumber.startsWith('NH-')),
      `${cv.status} ${cv.body.error ?? ''}`);
    const back = await json(await classPATCH(req(`/api/cases/${KR.id}/classification`, C.cookie, 'PATCH', { caseType: 'Noise Complaint', reason: 'Fictional: not an intimate partner after all' }), P(KR.id)));
    ok('moved back to the blotter desk: the open VAWC hearing is cancelled too', back.status === 200 && back.body.data?.hearingsCancelled === 1
      && (await prisma.caseHearing.findUnique({ where: { id: cv.body.data.id } }))?.status === 'CANCELLED');
    const rs = (await resident(R1.cookie)).data.history as Body[];
    ok('the resident sees each hearing under the case\'s current type', rs.find(g => g.case.caseNumber === KR.caseNumber)?.caseType === 'BLOTTER');
    const feed = ((await json(await updatesGET(req('/api/resident/updates?limit=20', R1.cookie)))).body.data ?? []) as Body[];
    const hearingFeed = feed.filter(u => u.entryLabel === 'Hearing update');
    ok('the resident is told a hearing was cancelled - not why', hearingFeed.some(u => /cancelled/.test(u.message ?? '')) && !hearingFeed.some(u => /reclassified|Domestic Violence/.test(u.message ?? '')));
    ok('hearing labels on the VAWC desk never name a KP stage', VAWC_HEARING_TYPE_KEYS.every(k => !/Mediation|Conciliation|Pangkat/.test(stageLabel(k))));
  } finally {
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
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.vh.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
