/**
 * AI-Assisted Report Correction, Follow-up and Standardization - the whole
 * workflow through the real routes and the real database (in-process), with
 * Groq replaced by a fake that can also be "down".
 * Run with:  npm run test:reportreview
 *
 * Fictional data only; every row is marked PROBE-RR and removed at the end,
 * and today's AI usage counter is put back.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import { checkProposals, cleanSummary, buildDraftFields } from '../lib/reportStandardizer';
import { generateDraft, retryPendingDrafts } from '../lib/reportReviewServer';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as myReportGET, POST as myReportPOST } from '../app/api/resident/cases/[id]/report/route';
import { GET as reviewGET, POST as reviewPOST } from '../app/api/cases/[id]/report-review/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RR';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const P = (id: string) => ({ params: Promise.resolve({ id }) });

// ── A fake Groq: the report reading (as at filing), and the standardization ──
const NARRATIVE = 'Kagabi po, maingay na naman ang videoke ni Mang Tonyo sa kabilang bahay hanggang alas-dos ng madaling araw. Siya po ang kapitbahay namin. Gusto ko po sanang kausapin siya ng barangay.';
const VAWC_NARRATIVE = 'Sinasaktan po ako ng asawa ko na si Ramon. Kahapon sinampal niya ako at sinabing papatayin daw niya ako kapag umalis ako. May dalawa kaming anak.';
const fake = { down: false, calls: 0, std: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  fake.calls++;
  if (fake.down) return new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503 });
  const body = JSON.parse(String(init?.body));
  const user = String(body.messages[1].content);
  const name = body.response_format?.json_schema?.name;
  let reply: unknown;
  if (name === 'report_standardization') {
    fake.std++;
    const fields: Body[] = [];
    if (user.includes('Mang Tonyo')) {
      fields.push({ key: 'respondentName', value: 'Mang Tonyo', quote: 'videoke ni Mang Tonyo', uncertain: false });
      fields.push({ key: 'incidentDate', value: '2026-11-07', quote: 'Kagabi po', uncertain: false });            // relative: must not become a date
      fields.push({ key: 'incidentTime', value: 'alas-dos ng madaling araw', quote: 'hanggang alas-dos ng madaling araw', uncertain: false });
      fields.push({ key: 'respondentRelationship', value: 'kapitbahay', quote: 'Siya po ang kapitbahay namin', uncertain: false });
      fields.push({ key: 'requestedRelief', value: 'Kausapin ng barangay ang kapitbahay', quote: 'Gusto ko po sanang kausapin siya ng barangay', uncertain: false });
      fields.push({ key: 'respondentAge', value: '45', quote: 'videoke ni Mang Tonyo', uncertain: false });   // no number stated: dropped
      fields.push({ key: 'personsInvolved', value: 'Sinuntok ang reporter', quote: 'sinuntok niya ako', uncertain: false }); // not in the text: dropped
      if (user.includes('alas-tres')) fields.push({ key: 'witnesses', value: 'baka ang anak ni Aling Nena', quote: 'baka ang anak ni Aling Nena ang nakakita', uncertain: false });
    }
    if (user.includes('Ramon')) {
      fields.push({ key: 'perpName', value: 'Ramon', quote: 'asawa ko na si Ramon', uncertain: false });
      fields.push({ key: 'perpRelationship', value: 'asawa', quote: 'Sinasaktan po ako ng asawa ko', uncertain: false });
      fields.push({ key: 'incidentDate', value: '2026-11-07', quote: 'Kahapon', uncertain: false });
    }
    reply = { fields, summary: 'The reporter states that a neighbour played loud videoke late at night and asks the barangay to talk to him.', complaintNature: 'Ingay ng videoke sa gabi' };
  } else {
    reply = { facts: [], slots: [], category: 'UNCLEAR', categoryConfidence: 'low', alternativeCategories: [], reasons: [],
      assessment: { framework: user.includes('Ramon') ? 'VAWC' : 'BLOTTER', riskLevel: null, riskLabel: 'x', criteria: [], informationSufficient: true, essentialMissing: [],
        classificationStatus: 'PRELIMINARY', understanding: 'Read.', missingInformation: [], uncertainty: [], recommendedNextAction: 'Talk to the reporter.',
        urgentHumanReview: false, affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT' } };
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { total_tokens: 40 } }), { status: 200 });
}) as typeof fetch;

async function main() {
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── The rules on their own ──
    console.log('\nThe standardization rules');
    const blocks = [{ version: 1, label: 'ORIGINAL', by: 'resident' as const, text: 'Noong 2026-11-03 ng gabi, baka si Pedro ang kumuha. Siya ay 34 taong gulang.' },
      { version: 2, label: 'ADDED', by: 'resident' as const, text: 'Ang kapitbahay ko pala ang nakakita.' }];
    const ck = checkProposals('BLOTTER', [
      { key: 'incidentDate', value: '2026-11-03', quote: 'Noong 2026-11-03', uncertain: false },
      { key: 'respondentName', value: 'Pedro', quote: 'baka si Pedro ang kumuha', uncertain: false },
      { key: 'respondentAge', value: '34', quote: 'Siya ay 34 taong gulang', uncertain: false },
      { key: 'witnesses', value: 'Ang kapitbahay', quote: 'Ang kapitbahay ko pala ang nakakita', uncertain: false },
      { key: 'respondentAddress', value: 'Purok 3', quote: 'nakatira sa Purok 3', uncertain: false },
      { key: 'sexAtBirth', value: 'male', quote: 'si Pedro', uncertain: false },
    ], blocks, new Date('2026-11-08T00:00:00Z'));
    ok('a written date is kept, from the original', ck.accepted.incidentDate?.status === 'ORIGINAL' && ck.accepted.incidentDate.value === '2026-11-03');
    ok('a hedged statement ("baka") is UNVERIFIED, not a fact', ck.accepted.respondentName?.status === 'UNVERIFIED');
    ok('an age with a stated number is kept', ck.accepted.respondentAge?.value === '34');
    ok('something from a later version is marked NEW', ck.accepted.witnesses?.status === 'NEW' && ck.accepted.witnesses.source === 'v2');
    ok('a quote that is not in the text is dropped', !ck.accepted.respondentAddress);
    ok('a field the AI may not fill (sex) is dropped', !ck.accepted.sexAtBirth && ck.dropped >= 2);
    ok('a future date is never kept', !checkProposals('BLOTTER', [{ key: 'incidentDate', value: '2099-01-01', quote: '2026-11-03', uncertain: false }], blocks, new Date('2026-11-08')).accepted.incidentDate);
    ok('a summary that calls someone guilty is thrown away', cleanSummary('Mang Tonyo is guilty of the disturbance.') === null && cleanSummary('The reporter states there was noise.') !== null);
    const built = buildDraftFields({ template: 'BLOTTER', records: { incidentTime: { value: '9:00 PM', status: 'RESIDENT_CONFIRMED' } },
      answers: [{ key: 'incidentTime', value: '10:00 PM', version: 3, by: 'resident' }], ai: ck, carried: {}, narrativeKey: 'narrative', original: 'Orig', additions: [] });
    ok('a later direct answer wins over the form value, and is marked as the resident\'s', built.incidentTime.value === '10:00 PM' && built.incidentTime.status === 'RESIDENT_CONFIRMED' && built.incidentTime.source === 'v3');
    ok('the narrative is the original, untouched', built.narrative.value === 'Orig' && built.narrative.status === 'ORIGINAL');
    ok('a field nobody supplied is NEEDS_CONFIRMATION', built.requestedRelief.status === 'NEEDS_CONFIRMATION' && built.requestedRelief.value === null);

    // ── People ──
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.rr.${k}.${process.pid}@safcom.local`, name: `Probe ${k}`, password: pw, role } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const mkRes = async (k: string, first: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: first, lastName: 'Probe', age: 35, gender: 'Female',
        barangay: 'Ayukit', address: 'temporary', contactNumber: '09170000000', emailVerified: true } });
      residents.push(r.id); return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const B = await mkUser('blotter', 'officer'), B2 = await mkUser('blotter2', 'officer'), V = await mkUser('vawc', 'vawc_officer');
    const R1 = await mkRes('a', 'Liza'), R2 = await mkRes('b', 'Other'), R3 = await mkRes('c', 'Marites');

    // ── 1-2. A resident files in their own words; Groq reads it ──
    console.log('\n1-2. Filing an unstructured narrative');
    const filed = await json(await filePOST(req('/api/resident/cases', R1.cookie, 'POST', { description: NARRATIVE, intakeNarrative: NARRATIVE, barangay: 'Ortega Compound',
      reportingRelationship: 'SELF', intakeAnswers: [] })));
    ok('the report is filed', filed.status === 201, `${filed.status} ${filed.body.error ?? ''}`);
    const id = filed.body.data.id as string; caseIds.push(id);
    await prisma.case.update({ where: { id }, data: { assignedToId: B.id } });
    const first = await prisma.reportDraft.findFirst({ where: { caseId: id } });
    ok('a first draft exists at once, from the records alone - filing does not wait on the AI', first?.generator === 'rules' && first.template === 'BLOTTER');
    ok('...with the narrative exactly as written', (first?.fields as Body).narrative.value === NARRATIVE);

    // ── 5-6. SafeComm AI organizes it; missing stays missing ──
    console.log('\n5-6. The AI-organized draft');
    const d1 = await generateDraft(id, { useAi: true, by: { residentId: R1.id }, chargeTo: R1.id, reason: 'test' });
    const f1 = d1.fields as Body;
    ok('an AI draft in the Blotter template', d1.generator === 'ai' && d1.template === 'BLOTTER');
    ok('the respondent\'s name, time, relationship and requested action - each from the resident\'s words', f1.respondentName.status === 'ORIGINAL' && f1.incidentTime.value === 'alas-dos ng madaling araw'
      && f1.respondentRelationship.value === 'kapitbahay' && f1.requestedRelief.status === 'ORIGINAL' && f1.requestedRelief.quote.includes('kausapin'));
    ok('"Kagabi" never becomes a date - the date NEEDS_CONFIRMATION, with what was said', f1.incidentDate.status === 'NEEDS_CONFIRMATION' && /Kagabi/.test(f1.incidentDate.note ?? ''));
    ok('an age with no number, and an invented quote, are dropped', f1.respondentAge.status === 'NEEDS_CONFIRMATION' && f1.personsInvolved.status === 'NEEDS_CONFIRMATION');
    ok('the AI\'s own wording is marked AI_ORGANIZED, the summary kept apart', f1.complaintNature.status === 'AI_ORGANIZED' && Boolean(d1.summary));
    ok('the street the resident picked is the location, as they gave it', f1.incidentLocation.status === 'RESIDENT_CONFIRMED');
    ok('the category is not filled until an officer reviews it', f1.incidentCategory.status === 'NEEDS_CONFIRMATION');
    ok('reporting about themselves, "who are they to the complainant" is not applicable - never AI-filled', f1.complainantRelationshipNote.status === 'RECORDED'
      && /Not applicable/.test(f1.complainantRelationshipNote.value));

    // ── 3-4. Follow-up questions, answered and skipped ──
    console.log('\n3-4. Follow-up questions');
    const mine = (await json(await myReportGET(req(`/api/resident/cases/${id}/report`, R1.cookie), P(id)))).body.data;
    const qKeys = mine.questions.map((q: Body) => q.key);
    ok('it asks only what is missing: the date - not the time, place or requested action already given', qKeys.includes('incidentDate')
      && !qKeys.includes('incidentTime') && !qKeys.includes('incidentLocation') && !qKeys.includes('requestedRelief'), qKeys.join());
    ok('the optional questions are offered once ("What happened afterward?")', qKeys.includes('q_afterward') && qKeys.includes('q_important'));
    ok('the resident sees their original words and the organized draft', mine.original.text === NARRATIVE && mine.draft.rows.some((r: Body) => r.key === 'respondentName' && r.value === 'Mang Tonyo'));
    ok('the officer is never named to the resident', !mine.draft.rows.some((r: Body) => r.key === 'assignedOfficer') && !JSON.stringify(mine).includes('Probe blotter'));
    ok('a future date is refused',(await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'answers', answers: [{ key: 'incidentDate', value: '2999-01-01' }] }), P(id)))).status === 400);
    ok('an answer to a question this report cannot be asked is refused', (await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'answers', answers: [{ key: 'victimName', value: 'x' }] }), P(id)))).status === 400);
    const ans = await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'answers',
      answers: [{ key: 'incidentDate', value: '2026-11-07' }, { key: 'q_afterward', skipped: true }] }), P(id)));
    ok('answers are saved as version 2', ans.status === 201 && ans.body.data.version === 2, `${ans.status} ${ans.body.error ?? ''}`);
    const mine2 = (await json(await myReportGET(req(`/api/resident/cases/${id}/report`, R1.cookie), P(id)))).body.data;
    ok('an answered question and a skipped one are not asked again', !mine2.questions.some((q: Body) => q.key === 'incidentDate' || q.key === 'q_afterward'));
    ok('the date is now the resident\'s, from version 2', mine2.draft.rows.find((r: Body) => r.key === 'incidentDate')?.status === 'RESIDENT_CONFIRMED');

    // ── 7-8. Edit / add information; the original stays ──
    console.log('\n7-8. Correcting and adding - never overwriting');
    const corr = await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'correction',
      text: 'Pasensya po, hindi alas-dos kundi alas-tres ng madaling araw natapos. Sa tingin ko baka ang anak ni Aling Nena ang nakakita.', reason: 'Mali ang oras na nailagay ko' }), P(id)));
    ok('a correction is version 3, with its reason', corr.status === 201 && corr.body.data.version === 3);
    ok('a correction needs the resident\'s own words', (await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'correction', reason: 'x' }), P(id)))).status === 400);
    const v3 = await prisma.reportAddendum.findUnique({ where: { caseId_version: { caseId: id, version: 3 } } });
    ok('each version records the version before it, the user, the time and the reason', v3?.previousVersion === 2 && v3.residentId === R1.id && Boolean(v3.createdAt) && v3.reason === 'Mali ang oras na nailagay ko' && v3.material);
    const stored = await prisma.case.findUnique({ where: { id }, select: { description: true, intake: { select: { narrative: true } } } });
    ok('the original narrative is untouched', stored?.description === NARRATIVE && stored.intake?.narrative === NARRATIVE);
    let immutable = false;
    try { await prisma.reportAddendum.update({ where: { id: v3!.id }, data: { text: 'rewritten' } }); } catch { immutable = true; }
    ok('a version cannot be rewritten, even directly in the database', immutable);
    ok('another resident cannot read or add to this report (not found)', (await json(await myReportGET(req(`/api/resident/cases/${id}/report`, R2.cookie), P(id)))).status === 404
      && (await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R2.cookie, 'POST', { kind: 'addition', text: 'not mine' }), P(id)))).status === 404);

    // ── Official review ──
    console.log('\nOfficial: Report Review and Clarification');
    const rv = (cookie: string, body: Body) => reviewPOST(req(`/api/cases/${id}/report-review`, cookie, 'POST', body), P(id)).then(json);
    const view = (await json(await reviewGET(req(`/api/cases/${id}/report-review`, B.cookie), P(id)))).body.data;
    ok('the official sees the original, every version and every draft', view.original.text === NARRATIVE && view.versions.length === 2 && view.drafts.length >= 3);
    ok('...and what is still missing, to ask about', view.suggestions.some((s: Body) => s.key === 'respondentAge'));
    ok('an officer the case is not assigned to cannot act on it', (await rv(B2.cookie, { action: 'regenerate' })).status === 403);

    // ── 9-10. Clarification request and response ──
    console.log('\n9-10. Request Resident Clarification');
    const askR = await rv(B.cookie, { action: 'request_clarification', message: 'Salamat po sa report.', items: [{ key: 'respondentAddress', question: 'Saan po nakatira si Mang Tonyo?' }] });
    ok('the official asks for the respondent\'s address', askR.status === 201);
    const upd = (await json(await updatesGET(req('/api/resident/updates?limit=20', R1.cookie)))).body.data;
    const notice = JSON.stringify(upd);
    ok('the resident is notified in general words - the question itself is not in the notice', /asked for more information about your report/.test(notice) && !notice.includes('Saan po nakatira'));
    const mine3 = (await json(await myReportGET(req(`/api/resident/cases/${id}/report`, R1.cookie), P(id)))).body.data;
    const open = mine3.requests.find((r: Body) => r.status === 'OPEN');
    ok('the request is in the resident\'s report details', open?.items[0].question === 'Saan po nakatira si Mang Tonyo?');
    const answered = await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'clarification', requestId: open.id,
      answers: [{ key: 'respondentAddress', value: 'Purok 2, katabi ng tindahan' }] }), P(id)));
    ok('the resident answers it - version 4', answered.status === 201 && answered.body.data.version === 4);
    const reqRow = await prisma.clarificationRequest.findUnique({ where: { id: open.id } });
    ok('the request is answered, with the time and the version', reqRow?.status === 'ANSWERED' && Boolean(reqRow.answeredAt) && Boolean(reqRow.addendumId));
    ok('the official is notified', (await prisma.notification.count({ where: { userId: B.id, caseId: id, title: { startsWith: 'Clarification received' } } })) === 1);
    ok('an answered request cannot be answered again', (await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'clarification', requestId: open.id, text: 'again' }), P(id)))).status === 409);

    // ── 11. Interview ──
    console.log('\n11. Record Interview');
    const iv = await rv(B.cookie, { action: 'record_interview', interviewedAt: new Date(Date.now() - 3600_000).toISOString(), contactMethod: 'IN_PERSON',
      questions: [{ question: 'Ilang beses na po ito nangyari?', answer: 'Tatlong beses na po ngayong buwan.' }, { question: 'Ilang taon na po si Mang Tonyo?', answer: 'mga 50', fieldKey: 'respondentAge' }],
      notes: 'Kinausap ang reporter sa barangay hall.', followUpActions: 'Ipatawag ang respondent.' });
    ok('the interview is recorded, and kept as report version 5', iv.status === 201 && iv.body.data.version === 5);
    ok('it cannot be dated in the future', (await rv(B.cookie, { action: 'record_interview', interviewedAt: new Date(Date.now() + 86_400_000).toISOString(), contactMethod: 'IN_PERSON',
      questions: [{ question: 'Test?', answer: 'x' }] })).status === 400);

    // ── 12, 14. Regenerate; the assessment re-runs on the new information ──
    console.log('\n12, 14. Regenerate AI Draft and reassess');
    const before = await prisma.case.findUnique({ where: { id }, select: { caseType: true, riskLevel: true } });
    const runsBefore = await prisma.assessmentHistory.count({ where: { caseId: id, kind: 'ai_reassessment' } });
    const reg = await rv(B.cookie, { action: 'regenerate', reason: 'After the interview' });
    ok('a new AI draft', reg.status === 201 && reg.body.data.generator === 'ai', `${reg.status} ${reg.body.error ?? ''} ${reg.body.data?.aiStatus ?? ''}`);
    ok('the new information changed what happened, so the existing assessment ran again (versions 3 and 5)', reg.body.data.reassessment?.versions?.join() === '3,5'
      && (await prisma.assessmentHistory.count({ where: { caseId: id, kind: 'ai_reassessment' } })) === runsBefore + 1, JSON.stringify(reg.body.data.reassessment));
    ok('...its result is advisory: the official category and risk level are unchanged', JSON.stringify(await prisma.case.findUnique({ where: { id }, select: { caseType: true, riskLevel: true } })) === JSON.stringify(before)
      && /unchanged until an officer reviews/.test(reg.body.data.reassessment.note));
    const latest = await prisma.reportDraft.findFirst({ where: { caseId: id }, orderBy: { draftNumber: 'desc' } });
    const lf = latest!.fields as Body;
    ok('each detail says where it came from: original, the resident\'s answer, the interview, unverified', lf.respondentName.status === 'ORIGINAL'
      && lf.respondentAddress.status === 'RESIDENT_CONFIRMED' && lf.respondentAddress.source === 'v4'
      && lf.respondentAge.status === 'NEW' && lf.respondentAge.note === 'From a recorded interview'
      && lf.witnesses.status === 'UNVERIFIED', JSON.stringify({ a: lf.respondentAddress, b: lf.respondentAge, w: lf.witnesses }));
    ok('the narrative is still the original, with versions 3 and 5 beside it', lf.narrative.value === NARRATIVE && lf.narrative.additions.map((a: Body) => a.version).join() === '3,5');
    ok('earlier drafts are kept, superseded', (await prisma.reportDraft.count({ where: { caseId: id, status: 'SUPERSEDED' } })) >= 3 && latest!.status === 'DRAFT');
    const view2 = (await json(await reviewGET(req(`/api/cases/${id}/report-review`, B.cookie), P(id)))).body.data;
    ok('Review Changes lists what changed since the last draft', view2.changes.some((ch: Body) => ch.key === 'respondentAge') && view2.changes.some((ch: Body) => ch.key === 'narrative'));
    ok('no reassessment is due any more', view2.reassessDue.length === 0);

    // ── 13. Approve ──
    console.log('\n13. Approve Official Report');
    const edit = await rv(B.cookie, { action: 'edit_field', draftId: latest!.id, key: 'actionTaken', value: 'Pinaalalahanan ang respondent tungkol sa ingay.', reason: 'Aksyong ginawa ng barangay' });
    ok('an official correction is a new draft, marked as the official\'s', edit.status === 201);
    ok('the original narrative cannot be edited', (await rv(B.cookie, { action: 'edit_field', draftId: latest!.id, key: 'narrative', value: 'x', reason: 'try' })).status === 409);
    const toApprove = await prisma.reportDraft.findFirst({ where: { caseId: id }, orderBy: { draftNumber: 'desc' } });
    ok('the edited field is OFFICIAL', (toApprove!.fields as Body).actionTaken.status === 'OFFICIAL');
    const noAck = await rv(B.cookie, { action: 'approve', draftId: toApprove!.id });
    ok('fields still needing confirmation stop a plain approval', noAck.status === 409 && toApprove!.needsConfirmation > 0);
    ok('an older draft cannot be approved', (await rv(B.cookie, { action: 'approve', draftId: latest!.id, acknowledgeOutstanding: true, note: 'Reviewed' })).status === 409);
    const appr = await rv(B.cookie, { action: 'approve', draftId: toApprove!.id, acknowledgeOutstanding: true, note: 'Reviewed with the reporter; date confirmed.' });
    const approvedRow = await prisma.reportDraft.findUnique({ where: { id: toApprove!.id } });
    ok('approved by the official, with who, when and the note', appr.status === 200 && approvedRow?.status === 'APPROVED' && approvedRow.approvedById === B.id && Boolean(approvedRow.approvedAt));
    let locked = false;
    try { await prisma.reportDraft.update({ where: { id: toApprove!.id }, data: { summary: 'changed' } }); } catch { locked = true; }
    ok('an approved draft\'s content cannot be changed in the database', locked);
    ok('the resident\'s view hides officials\' records', !JSON.stringify((await json(await myReportGET(req(`/api/resident/cases/${id}/report`, R1.cookie), P(id)))).body.data.draft).includes('Pinaalalahanan'));

    // ── 16. AI down: nothing is lost ──
    console.log('\n16. When the AI is down');
    fake.down = true;
    const add = await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'addition', text: 'Nagpatuloy pa rin po ang ingay ngayong gabi.' }), P(id)));
    ok('a resident\'s addition is saved while the AI is down', add.status === 201 && add.body.data.version === 6);
    const down = await rv(B.cookie, { action: 'regenerate' });
    ok('regenerating gives a records-only draft and says the AI was unavailable', down.status === 201 && down.body.data.generator === 'rules' && down.body.data.aiStatus !== 'ok');
    const dd = await prisma.reportDraft.findFirst({ where: { caseId: id }, orderBy: { draftNumber: 'desc' } });
    ok('...keeping what the last AI reading found, and the new words', (dd!.fields as Body).respondentName.value === 'Mang Tonyo' && (dd!.fields as Body).narrative.additions.some((a: Body) => a.version === 6));
    const danger = await json(await myReportPOST(req(`/api/resident/cases/${id}/report`, R1.cookie, 'POST', { kind: 'addition', text: 'Pinagbantaan po niya akong papatayin ngayon, natatakot po ako.' }), P(id)));
    ok('an immediate danger is flagged at once, without the AI', danger.status === 201 && danger.body.data.emergency === true
      && (await prisma.case.findUnique({ where: { id }, select: { triageStatus: true } }))?.triageStatus === 'URGENT_REVIEW', JSON.stringify(danger.body.data));
    fake.down = false;
    const retried = await retryPendingDrafts(10, caseIds);
    ok('the retry job turns the waiting draft into an AI draft once the AI is back', retried.some(r => r.caseNumber === filed.body.data.caseNumber && r.outcome.startsWith('ai')), JSON.stringify(retried));

    // ── 15. VAWC ──
    console.log('\n15. VAWC: restricted, and safe contact');
    const vf = await json(await filePOST(req('/api/resident/cases', R3.cookie, 'POST', { description: VAWC_NARRATIVE, intakeNarrative: VAWC_NARRATIVE, barangay: 'Ortega Compound',
      reportingRelationship: 'SELF', intakeAnswers: [], contactPreference: 'no_phone' })));
    ok('a VAWC report is filed', vf.status === 201, `${vf.status} ${vf.body.error ?? ''}`);
    const vid = vf.body.data.id as string; caseIds.push(vid);
    await prisma.case.update({ where: { id: vid }, data: { assignedToId: V.id, caseType: 'Domestic Violence', contactPreference: 'no_phone' } });
    const vrv = (cookie: string, body: Body) => reviewPOST(req(`/api/cases/${vid}/report-review`, cookie, 'POST', body), P(vid)).then(json);
    ok('a blotter officer cannot open its report review (not found)', (await json(await reviewGET(req(`/api/cases/${vid}/report-review`, B.cookie), P(vid)))).status === 404
      && (await vrv(B.cookie, { action: 'regenerate' })).status === 404);
    const vreg = await vrv(V.cookie, { action: 'regenerate' });
    ok('the VAWC officer regenerates its draft in the VAWC template', vreg.status === 201);
    const vd = await prisma.reportDraft.findFirst({ where: { caseId: vid }, orderBy: { draftNumber: 'desc' } });
    const vfl = vd!.fields as Body;
    ok('VAWC template: the alleged perpetrator from the resident\'s words; "Kahapon" is not a date', vd!.template === 'VAWC' && vfl.perpName.value === 'Ramon'
      && vfl.perpRelationship.value === 'asawa' && vfl.incidentDate.status === 'NEEDS_CONFIRMATION');
    ok('sex and the form of violence are never filled by the AI', vfl.sexAtBirth.status === 'NEEDS_CONFIRMATION' && vfl.typeOfViolence.status === 'NEEDS_CONFIRMATION');
    ok('calling a reporter who asked not to be called needs the official to confirm it was arranged safely', (await vrv(V.cookie, { action: 'record_interview',
      interviewedAt: new Date(Date.now() - 600_000).toISOString(), contactMethod: 'PHONE', questions: [{ question: 'Ligtas po ba kayo?', answer: 'Opo' }] })).status === 409);
    const vmine = (await json(await myReportGET(req(`/api/resident/cases/${vid}/report`, R3.cookie), P(vid)))).body.data;
    ok('the resident\'s view leaves out the safety assessment and referrals sections', !vmine.draft.rows.some((r: Body) => ['safetyAssessment', 'referrals', 'interventions', 'typeOfViolence'].includes(r.key)));
    ok('VAWC follow-up questions ask nothing about the person responsible', !vmine.questions.some((q: Body) => /perp/.test(q.key)));
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.aiUsage.deleteMany({ where: { OR: [...residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })), ...users.map(id => ({ bucket: { startsWith: `resident:staff:${id}:` } })),
      { bucket: { startsWith: 'resident:system:report-drafts:' } }] } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0 && await prisma.reportDraft.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed (fake Groq calls: ${fake.calls}, standardization: ${fake.std})`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
