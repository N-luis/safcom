/**
 * VAWC Case Proceedings and the court-date type of VAWC Hearings - the rules alone (no database).
 * Run with:  npm run test:vawcproceedings:rules
 */
import fs from 'fs';
import path from 'path';
import {
  bpoLastDay, bpoInEffect, bpoDecisionRefusal, bpoServiceRefusal, bpoAllowed, activityItems, remindersDue, reminderMessage,
  BPO_EFFECTIVE_DAYS, BPO_APPLICANT_KEYS, BPO_ACTING_KEYS, BPO_SERVICE_KEYS, BPO_STATUSES,
  REFERRAL_AGENCY_KEYS, VAWC_REFERRAL_STATUS_KEYS, type BpoLike, type ReferralLike,
} from '../lib/vawcProceedings';
import {
  forbiddenRequest, courtRefusal, residentAppointmentMessage, residentInstructionsFor, typeLabel, APPOINTMENT_TYPE_KEYS, PARTICIPANT_KEYS,
  COURT_MATTER_KEYS, COURT_SOURCE_KEYS, MODULE_LABEL,
} from '../lib/vawcAppointments';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
// Philippine time, fixed: 16 Nov 2026, 10:00.
const NOW = new Date('2026-11-16T10:00:00+08:00');
const at = (s: string) => new Date(`${s}+08:00`);
const C = { id: 'c1', caseNumber: 'SC-TEST-1' };

console.log('1. the BPO period (RA 9262 sec. 14: 15 days)');
ok('15 days', BPO_EFFECTIVE_DAYS === 15);
ok('issued 16 Nov -> last effective day 30 Nov (the day of issuance is day 1)', bpoLastDay(at('2026-11-16T09:00:00')) === '2026-11-30');
ok('issued late at night, Philippine time, counts from that Philippine day', bpoLastDay(new Date('2026-11-16T15:30:00Z')) === '2026-11-30', bpoLastDay(new Date('2026-11-16T15:30:00Z')));
ok('in effect on day 15, not on day 16', bpoInEffect(at('2026-11-01T09:00:00'), at('2026-11-15T23:00:00')) && !bpoInEffect(at('2026-11-01T09:00:00'), at('2026-11-16T00:30:00')));
ok('nothing is in effect without an issuance date', !bpoInEffect(null, NOW));

console.log('\n2. recording the decision and the service');
const applied = at('2026-11-16T08:00:00');
ok('a Kagawad decision needs the attestation that the Punong Barangay was unavailable',
  /unavailable/.test(bpoDecisionRefusal({ decision: 'ISSUED', acting: 'KAGAWAD', pbUnavailable: false, decidedAt: at('2026-11-16T09:00:00'), appliedAt: applied }, NOW) ?? ''));
ok('...with it, accepted', bpoDecisionRefusal({ decision: 'ISSUED', acting: 'KAGAWAD', pbUnavailable: true, decidedAt: at('2026-11-16T09:00:00'), appliedAt: applied }, NOW) === null);
ok('the Punong Barangay needs no attestation', bpoDecisionRefusal({ decision: 'DENIED', acting: 'PUNONG_BARANGAY', pbUnavailable: false, decidedAt: at('2026-11-16T09:00:00'), appliedAt: applied }, NOW) === null);
ok('a decision cannot be before the application', /before/.test(bpoDecisionRefusal({ decision: 'ISSUED', acting: 'PUNONG_BARANGAY', pbUnavailable: false, decidedAt: at('2026-11-16T07:00:00'), appliedAt: applied }, NOW) ?? ''));
ok('...or in the future', /future/.test(bpoDecisionRefusal({ decision: 'ISSUED', acting: 'PUNONG_BARANGAY', pbUnavailable: false, decidedAt: at('2026-11-16T15:00:00'), appliedAt: applied }, NOW) ?? ''));
ok('service only after issuance', /only after/.test(bpoServiceRefusal(at('2026-11-16T09:30:00'), null, NOW) ?? '') && /before/.test(bpoServiceRefusal(at('2026-11-16T08:30:00'), at('2026-11-16T09:00:00'), NOW) ?? '')
  && bpoServiceRefusal(at('2026-11-16T09:30:00'), at('2026-11-16T09:00:00'), NOW) === null);
ok('each step once: decide from APPLIED only, serve from ISSUED only', bpoAllowed('decide', 'APPLIED') && !bpoAllowed('decide', 'ISSUED') && bpoAllowed('serve', 'ISSUED')
  && !bpoAllowed('serve', 'SERVED') && !bpoAllowed('serve', 'DENIED') && !bpoAllowed('decide', 'CANCELLED'));

console.log('\n3. due dates and reminders');
const bpo = (o: Partial<BpoLike>): BpoLike => ({ id: 'b', reference: 'BPO-1', status: 'APPLIED', appliedAt: at('2026-11-16T08:00:00'), decidedAt: null, case: C, ...o });
const ref = (o: Partial<ReferralLike>): ReferralLike => ({ id: 'r', reference: 'REF-1', status: 'REFERRED', followUpAt: at('2026-11-16T09:00:00'), agencyType: 'SWDO', agencyName: 'MSWDO', case: C, ...o });
const items = activityItems({
  bpos: [bpo({ id: 'b1' }), bpo({ id: 'b2', status: 'ISSUED', decidedAt: at('2026-11-14T10:00:00') }), bpo({ id: 'b3', status: 'SERVED', decidedAt: at('2026-11-04T10:00:00') }),
    bpo({ id: 'b4', status: 'DENIED', decidedAt: at('2026-11-10T10:00:00') }), bpo({ id: 'b5', status: 'CANCELLED' })],
  referrals: [ref({ id: 'r1' }), ref({ id: 'r2', status: 'COMPLETED' }), ref({ id: 'r3', followUpAt: null })],
}, NOW);
const kinds = (id: string) => items.filter(i => i.recordId === id).map(i => i.kind).join(',');
ok('an application awaiting decision is due the day it was filed', kinds('b1') === 'BPO_DECIDE');
ok('an issued, unserved BPO: serve (overdue from a past day) and its last day', kinds('b2') === 'BPO_SERVE,BPO_ENDS' && items.find(i => i.recordId === 'b2' && i.kind === 'BPO_SERVE')!.overdue);
ok('a served BPO shows only its last effective day', kinds('b3') === 'BPO_ENDS' && items.find(i => i.recordId === 'b3')!.day === '2026-11-18');
ok('a denied or cancelled BPO has no dates', kinds('b4') === '' && kinds('b5') === '');
ok('an open referral\'s follow-up is due; a completed one, or one without a date, is not', kinds('r1') === 'REFERRAL_FOLLOW_UP' && kinds('r2') === '' && kinds('r3') === '');
const due = remindersDue(items, NOW).map(i => i.recordId).sort().join(',');
ok('reminders now: decide today, serve (overdue), last day within 3 days, follow-up today', due === 'b1,b2,b3,r1', due);
ok('the BPO issued 14 Nov ends 28 Nov - too far off for a reminder today', !remindersDue(items, NOW).some(i => i.recordId === 'b2' && i.kind === 'BPO_ENDS'));
ok('each reminder has its own key, so it is sent once', new Set(remindersDue(items, NOW).map(i => i.key)).size === remindersDue(items, NOW).length);
const msg = reminderMessage(items.find(i => i.recordId === 'b1')!);
ok('a reminder names the step, the record and the case - nothing else', /BPO - decide today: BPO-1 on case SC-TEST-1/.test(msg) && !/note|assessment|victim|respondent/i.test(msg), msg);

console.log('\n4. nothing that belongs to a court, a mediation or the respondent');
ok('a respondent cannot be added as a participant', Boolean(forbiddenRequest({ participants: ['RESPONDENT'] })));
ok('a mediation or joint "hearing" type is refused', Boolean(forbiddenRequest({ type: 'JOINT_MEDIATION' })) && Boolean(forbiddenRequest({ type: 'BPO_HEARING' })));

console.log('\n5. an external court hearing is a Hearing, tracked only');
ok('the module is called Hearings', MODULE_LABEL === 'Hearings');
ok('the court type is accepted by its exact key', forbiddenRequest({ type: 'EXTERNAL_COURT_HEARING' }) === null && typeLabel('EXTERNAL_COURT_HEARING').includes('tracking only'));
ok('...while anything else "hearing" or "mediation" is still refused', Boolean(forbiddenRequest({ type: 'KP_HEARING' })) && Boolean(forbiddenRequest({ type: 'external_court_hearing ' })));
ok('asking SafeComm to conduct or preside is refused', /cannot create or conduct/.test(forbiddenRequest({ action: 'conduct' }) ?? ''));
ok('a court date needs its matter and its official source', /matter/.test(courtRefusal('EXTERNAL_COURT_HEARING', { courtSource: 'COURT_NOTICE' }) ?? '')
  && /officially provided/.test(courtRefusal('EXTERNAL_COURT_HEARING', { courtMatter: 'TPO' }) ?? '')
  && courtRefusal('EXTERNAL_COURT_HEARING', { courtMatter: 'TPO', courtSource: 'COURT_NOTICE' }) === null);
ok('no other type may carry court details', Boolean(courtRefusal('VICTIM_INTERVIEW', { courtMatter: 'TPO' })) && courtRefusal('VICTIM_INTERVIEW', {}) === null);
const courtMsg = residentAppointmentMessage({ kind: 'created', after: { type: 'EXTERNAL_COURT_HEARING', scheduledAt: '2026-11-20T01:00:00.000Z' } }) ?? '';
ok('the resident notice for a court date gives the date and nothing confidential', /Nov|November/.test(courtMsg) && !/court|VAWC|abuse|violence|respondent|SC-/i.test(courtMsg), courtMsg);
ok('...and does not say the barangay holds it', !/with the barangay/.test(courtMsg));
ok('the resident is told the barangay does not hold a court hearing', residentInstructionsFor('EXTERNAL_COURT_HEARING').some(l => /does not hold this hearing/.test(l)));

console.log('\n6. the database allows exactly these values (prisma/sql/020_vawc_proceedings.sql)');
const sql = fs.readFileSync(path.join(__dirname, '../prisma/sql/020_vawc_proceedings.sql'), 'utf8');
const listIn = (col: string) => {
  const m = new RegExp(`"${col}"(?: IS NULL OR "${col}")? IN \\(([^)]*)\\)`).exec(sql);
  return m ? m[1].split(',').map(x => x.trim().replace(/'/g, '')).sort().join(',') : '(missing)';
};
const same = (col: string, keys: readonly string[]) => ok(`${col}: the database and lib/vawcProceedings.ts agree`, listIn(col) === [...keys].sort().join(','), `${listIn(col)} vs ${[...keys].sort().join(',')}`);
same('applicantType', BPO_APPLICANT_KEYS);
same('actingRole', BPO_ACTING_KEYS);
same('serviceMethod', BPO_SERVICE_KEYS);
same('courtMatter', COURT_MATTER_KEYS);
same('courtSource', COURT_SOURCE_KEYS);
ok('hearing types: the database and lib/vawcAppointments.ts agree', listIn('type') === [...APPOINTMENT_TYPE_KEYS].sort().join(','), listIn('type'));
ok('no respondent participant in the database either', !/RESPONDENT/.test(sql) && PARTICIPANT_KEYS.every(p => sql.includes(`'${p}'`)));
ok('court details exactly when the type is the court\'s', sql.includes(`("type" <> 'EXTERNAL_COURT_HEARING' OR ("courtMatter" IS NOT NULL AND "courtSource" IS NOT NULL))`)
  && sql.includes(`("type" = 'EXTERNAL_COURT_HEARING' OR ("courtMatter" IS NULL AND "courtSource" IS NULL AND "courtReference" IS NULL))`));
same('agencyType', REFERRAL_AGENCY_KEYS);
ok('BPO statuses agree', /"status" IN \('APPLIED','ISSUED','SERVED','DENIED','CANCELLED'\)/.test(sql) && Object.keys(BPO_STATUSES).sort().join() === 'APPLIED,CANCELLED,DENIED,ISSUED,SERVED');
ok('referral statuses agree', sql.includes(`"status" IN (${VAWC_REFERRAL_STATUS_KEYS.map(k => `'${k}'`).join(',')})`));
ok('a Kagawad decision without the attestation is refused by the database too', sql.includes(`("actingRole" IS DISTINCT FROM 'KAGAWAD' OR "punongBarangayUnavailable")`));
ok('the records are for VAWC cases only, in the database', /vawc_proceeding_case_check[\s\S]*VAWC proceeding records are for VAWC cases only/.test(sql));
ok('the history cannot be changed', /vawc_proceeding_event_immutable[\s\S]*BEFORE UPDATE ON "VawcProceedingEvent"/.test(sql));
ok('no separate court table: court dates stay in VawcAppointment', !/VawcCourtHearing/.test(sql));
ok('no public API role can read the tables', ['VawcBpo', 'VawcReferral', 'VawcProceedingEvent'].every(t => sql.includes(`REVOKE ALL ON "${t}" FROM anon, authenticated;`) && sql.includes(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`)));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
