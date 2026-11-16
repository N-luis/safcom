/**
 * The KP eligibility review answers Yes, No or Not applicable - no Unknown -
 * and no case party can be linked to a resident's SafeComm account.
 * Run with:  npm run test:kpreview      No database.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import KpReviewForm from '../components/hearings/KpReviewForm';
import { KP_ANSWERS, KP_CHECKLIST, KP_KEYS, KP_ELIGIBILITY_STATES, decideKpReview, hearingEligibility, type KpAnswers } from '../lib/hearings';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const read = (f: string) => fs.readFileSync(f, 'utf8');
const allYes = Object.fromEntries(KP_KEYS.map(k => [k, 'YES'])) as KpAnswers;

console.log('\nThe eligibility review');
ok('the answers are Yes, No and Not applicable', KP_ANSWERS.join() === 'YES,NO,NOT_APPLICABLE');
ok('there is no "needs verification" state', KP_ELIGIBILITY_STATES.join() === 'PENDING_REVIEW,ELIGIBLE,NOT_ELIGIBLE');
ok('a point left unanswered keeps it pending; a No makes it not eligible; all cleared and approved is eligible',
  decideKpReview({ ...allYes, residence: null }, true).decision === 'PENDING_REVIEW' && decideKpReview({ ...allYes, venue: 'NO' }, true).decision === 'NOT_ELIGIBLE'
  && decideKpReview(allYes, true).decision === 'ELIGIBLE');
const old = hearingEligibility({ caseType: 'Noise Complaint', status: 'Open', verifiedCategory: { caseType: 'Noise Complaint', at: new Date() },
  review: { decision: 'NEEDS_VERIFICATION', caseType: 'Noise Complaint', at: new Date(), version: 2, checklist: { ...allYes, residence: 'UNKNOWN' }, approvedById: null } });
ok('an "Unknown" saved before reads as not answered, to be finished', old.state === 'PENDING_REVIEW' && old.answers?.residence === undefined && /1 point still to answer/.test(old.reasons.join(' ')), JSON.stringify(old.reasons));

const html = renderToStaticMarkup(<KpReviewForm caseId="c1" caseType="Noise Complaint" onSaved={() => undefined} />);
const naItems = KP_CHECKLIST.filter(c => c.na).length;
ok('the form shows no Unknown button', !/>Unknown</.test(html) && !html.includes('UNKNOWN'));
const buttons = (label: string) => (html.match(new RegExp(`<button[^>]*>${label}<`, 'g')) ?? []).length;
ok('every point has a Yes and a No button', buttons('Yes') === KP_CHECKLIST.length && buttons('No') === KP_CHECKLIST.length, `${buttons('Yes')} ${buttons('No')}`);
ok('Not applicable only where the point can not arise', buttons('Not applicable') === naItems && naItems === 3, String(buttons('Not applicable')));
const toggles = (html.match(/<button[^>]*MuiToggleButton-root[^>]*>/g) ?? []).length;
ok('no other answer button - Yes, No and Not applicable only', toggles === KP_CHECKLIST.length * 2 + naItems, String(toggles));
ok('the instructions no longer mention Unknown', !/Unknown/.test(html));
ok('the server refuses Unknown and says what is accepted', read('app/api/cases/[id]/kp-review/route.ts').includes("'Answer each point with Yes, No or Not applicable - or leave it for later'"));
ok('no screen offers the old state', !/NEEDS_VERIFICATION/.test(['components/hearings/HearingCasesTable.tsx', 'components/hearings/CreateHearingDialog.tsx', 'components/hearings/KpReviewForm.tsx', 'lib/hearingCasesServer.ts'].map(read).join()));

console.log('\nNo party linked to a resident account');
ok('the link / unlink endpoint is gone', !fs.existsSync('app/api/cases/[id]/parties'));
ok('no Link account or Unlink account control remains', !/Link account|Unlink account|PartyAccount|Resident number/.test(read('components/hearings/HearingDetailsDialog.tsx') + read('components/hearings/CreateHearingDialog.tsx')));
// lib/hearingsServer.ts is server-only, and rendering the form above needs the browser build, so its rules are read from the source.
const server = read('lib/hearingsServer.ts');
ok('the respondent\'s notices never go to a resident account; the complainant\'s go to the reporter', server.includes('return { COMPLAINANT: c.residentId ?? null, RESPONDENT: null }'));
ok('a resident sees only hearings on the cases they filed', server.includes('case: { caseType: { notIn: [...VAWC_TYPES] }, residentId },')
  && !/respondentParty: \{ residentId|complainantParty: \{ residentId/.test(server));
ok('a hearing\'s parties carry no account', server.includes('complainantParty: { select: { id: true, fullName: true } },')
  && server.includes('respondentParty: { select: { id: true, fullName: true } },'));
const schema = read('prisma/schema.prisma');
const partyModel = schema.slice(schema.indexOf('model CaseParty {'), schema.indexOf('}', schema.indexOf('model CaseParty {')));
ok('the database model holds no link', !/residentId|residentLinked/.test(partyModel) && !/caseParties\s+CaseParty\[\]/.test(schema));
ok('the drop script removes exactly the link columns', /DROP COLUMN IF EXISTS "residentId",\nDROP COLUMN IF EXISTS "residentLinkedAt",\nDROP COLUMN IF EXISTS "residentLinkedById";/.test(read('prisma/sql/015_remove_party_account_links.sql').replace(/\r\n/g, '\n')));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
