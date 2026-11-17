/**
 * VAWC Hearings (stored as VawcAppointment) - the rules, without a database.
 * Run with:  npm run test:vawcappointments:rules
 * (The full workflows, through the routes and the database: npm run test:vawcappointments.)
 */
import fs from 'fs';
import { VAWC_TYPES } from '../lib/vawcTypes';
import { RESIDENT_ACTIVITY_TYPES } from '../lib/notifications';
import {
  APPOINTMENT_TYPE_KEYS, PARTICIPANT_KEYS, NOTIFY_KEYS, APPOINTMENT_STATUSES, ATTENDANCE_KEYS, REFERRAL_STATUS_KEYS, RESIDENT_APPOINTMENT_EVENTS,
  normalizeParticipants, participantChoices, defaultParticipants, notifyRefusal, residentNotified, forbiddenRequest, residentAppointmentMessage,
  inView, appointmentAllowed, appointmentTimeRefusal, APPOINTMENT_EVENT_LABELS,
} from '../lib/vawcAppointments';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const read = (f: string) => fs.readFileSync(f, 'utf8');
const sql = read('prisma/sql/019_vawc_appointments.sql');
// 020 replaces 019's values check (one more type: the court's, tracked only); the rest of 019 stands.
const sql020 = read('prisma/sql/020_vawc_proceedings.sql');
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);

console.log('\nNo respondent, no mediation');
ok('no participant is the respondent', !PARTICIPANT_KEYS.some(p => /RESPOND|ACCUSED/.test(p)));
ok('no type is mediation, conciliation, reconciliation or a joint session', !APPOINTMENT_TYPE_KEYS.some(t => /MEDIAT|CONCILIAT|RECONCIL|JOINT|KP/.test(t)));
ok('the only "hearing" type is the court\'s, tracked only', APPOINTMENT_TYPE_KEYS.filter(t => /HEARING/.test(t)).join() === 'EXTERNAL_COURT_HEARING');
ok('the six types asked for', APPOINTMENT_TYPE_KEYS.join() === 'VICTIM_INTERVIEW,INTAKE_FOLLOW_UP,SAFETY_FOLLOW_UP,REFERRAL_COORDINATION,CASE_CONFERENCE,EXTERNAL_COURT_HEARING');
ok('a request naming the respondent or mediation is refused with the reason', forbiddenRequest({ participants: ['REPORTER', 'RESPONDENT'] }) !== null
  && forbiddenRequest({ type: 'MEDIATION' }) !== null && forbiddenRequest({ type: 'VICTIM_INTERVIEW', participants: ['REPORTER'] }) === null);

console.log('\nThe database checks the same values');
const check = sql020.slice(sql020.indexOf('VawcAppointment_values_check" CHECK'));
ok('types, statuses, notice choices, participants, attendance and referral status match the app', [...APPOINTMENT_TYPE_KEYS, ...Object.keys(APPOINTMENT_STATUSES), ...NOTIFY_KEYS,
  ...PARTICIPANT_KEYS, ...ATTENDANCE_KEYS, ...REFERRAL_STATUS_KEYS].every(v => check.includes(`'${v}'`)));
const lists = [...sql.matchAll(/"caseType" IN \(([^)]+)\)/g)].map(m => quoted(m[1]));
ok('both database rules use exactly the VAWC categories of lib/vawcTypes.ts', lists.length === 2 && lists.every(l => l.join('|') === [...VAWC_TYPES].join('|')), JSON.stringify(lists));
ok('row level security on, public API roles revoked, history insert-only', ['VawcAppointment', 'VawcAppointmentEvent', 'VawcAppointmentRequest']
  .every(t => sql.includes(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`) && sql.includes(`REVOKE ALL ON "${t}" FROM anon, authenticated`))
  && /BEFORE UPDATE ON "VawcAppointmentEvent"/.test(sql));
ok('a KP hearing on a VAWC case is refused by the database', /BEFORE INSERT ON "CaseHearing"/.test(sql));

console.log('\nWho is told');
ok('on a self-report the victim-survivor is the reporter', normalizeParticipants(['VICTIM_SURVIVOR', 'REPORTER'], 'SELF').join() === 'REPORTER'
  && normalizeParticipants(['VICTIM_SURVIVOR'], null).join() === 'REPORTER' && normalizeParticipants(['VICTIM_SURVIVOR'], 'THIRD_PARTY').join() === 'VICTIM_SURVIVOR'
  && !participantChoices('SELF').includes('VICTIM_SURVIVOR') && participantChoices('THIRD_PARTY').includes('VICTIM_SURVIVOR'));
ok('defaults: an interview is with the victim-survivor; a case conference is officials and providers', defaultParticipants('VICTIM_INTERVIEW', 'SELF').join() === 'REPORTER'
  && defaultParticipants('CASE_CONFERENCE', 'SELF').join() === 'VAWC_STAFF,SERVICE_PROVIDER');
ok('an in-app notice needs the reporter\'s account and the reporter among the participants', notifyRefusal('SAFECOMM_ACCOUNT', { hasAccount: false }, ['REPORTER']) !== null
  && notifyRefusal('SAFECOMM_ACCOUNT', { hasAccount: true }, ['VICTIM_SURVIVOR']) !== null && notifyRefusal('SAFECOMM_ACCOUNT', { hasAccount: true }, ['REPORTER']) === null
  && notifyRefusal('OFFICER_CONTACT', { hasAccount: false }, ['VICTIM_SURVIVOR']) === null);
ok('the resident is told only when notified in-app and a participant', residentNotified({ notifyVia: 'SAFECOMM_ACCOUNT', participants: ['REPORTER'] })
  && !residentNotified({ notifyVia: 'NONE', participants: ['REPORTER'] }) && !residentNotified({ notifyVia: 'SAFECOMM_ACCOUNT', participants: ['SERVICE_PROVIDER'] }));
const at = '2026-12-01T02:00:00.000Z';
const messages = RESIDENT_APPOINTMENT_EVENTS.map(k => residentAppointmentMessage({ kind: k, after: { scheduledAt: at, type: 'VICTIM_INTERVIEW' } }) ?? '');
ok('every resident message is safe to be seen: an appointment "with the barangay", no type, case or VAWC words', messages.every(m => m.length > 0
  && !/vawc|abuse|violence|victim|survivor|interview|respondent|case|safety/i.test(m)), messages.join(' | '));
ok('internal events tell the resident nothing', ['updated', 'completed', 'not_held', 'outcome_amended', 'resident_notified', 'reschedule_requested']
  .every(k => residentAppointmentMessage({ kind: k, after: { scheduledAt: at } }) === null));
ok('the desk\'s timeline line is not on the resident\'s list', !(RESIDENT_ACTIVITY_TYPES as readonly string[]).includes('vawc_appointment'));
ok('every event has a label for the history', ['created', 'updated', 'rescheduled', 'cancelled', 'completed', 'not_held', 'outcome_amended', 'resident_notified', 'resident_seen',
  'resident_acknowledged', 'reschedule_requested', 'request_approved', 'request_declined'].every(k => k in APPOINTMENT_EVENT_LABELS));

console.log('\nWhat the resident route sends');
const rRoute = read('app/api/resident/appointments/route.ts');
const select = rRoute.slice(rRoute.indexOf('select: {'), rRoute.indexOf('});', rRoute.indexOf('select: {')));
ok('it never reads the purpose, notes, outcome, follow-up, referral, officer, participants or reference', !/purpose|internalNotes|outcomeNotes|followUpActions|referralStatus|assignedOfficer|participants|reference|statusReason|attendance/.test(select));

console.log('\nThe calendar and the actions');
const now = new Date('2026-11-16T04:00:00Z');
const a = (status: string, offsetH: number, rescheduleCount = 0) => ({ status, scheduledAt: new Date(now.getTime() + offsetH * 3_600_000), rescheduleCount });
ok('upcoming, past, rescheduled, completed, cancelled', inView(a('SCHEDULED', 5), 'upcoming', now) && !inView(a('SCHEDULED', -5), 'upcoming', now)
  && inView(a('SCHEDULED', -5), 'past', now) && !inView(a('CANCELLED', -5), 'past', now) && inView(a('RESCHEDULED', 5, 1), 'rescheduled', now)
  && inView(a('COMPLETED', -5), 'completed', now) && inView(a('CANCELLED', 5), 'cancelled', now));
ok('a recorded or cancelled appointment cannot be moved or cancelled', !appointmentAllowed('reschedule', 'COMPLETED') && !appointmentAllowed('cancel', 'CANCELLED')
  && appointmentAllowed('amend_outcome', 'COMPLETED') && appointmentAllowed('reschedule', 'RESCHEDULED'));
ok('no date in the past, none more than a year ahead', appointmentTimeRefusal(new Date(now.getTime() - 3_600_000), now) !== null
  && appointmentTimeRefusal(new Date(now.getTime() + 400 * 86_400_000), now) !== null && appointmentTimeRefusal(new Date(now.getTime() + 86_400_000), now) === null);

console.log('\nKept apart from Hearing Management');
// Changed by the VAWC hearings merge: a VAWC case shows the same hearings card as a blotter case, in its VAWC form (one component, not a copy).
ok('the VAWC case page shows the shared hearings card in its VAWC form; the blotter page the blotter form', /includes\(caseData\.caseType\) && <HearingsPanel caseId=\{id\} onChanged=\{onSaved\} vawc \/>/.test(read('components/cases/CaseWorkspace.tsx'))
  && /!\(VAWC_TYPES as readonly string\[\]\)\.includes\(caseData\.caseType\) && <HearingsPanel caseId=\{id\} onChanged=\{onSaved\} \/>/.test(read('components/cases/CaseWorkspace.tsx'))
  && !/VawcAppointmentsPanel/.test(read('components/cases/CaseWorkspace.tsx')));
const vawcNav = read('app/vawc/layout.tsx');
const blotterNav = read('app/blotter-officer/layout.tsx');
const navOrder = (src: string) => [...src.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
ok('both sidebars say "Hearings", once, right after Case Classification', ['Hearings'].every(l => navOrder(vawcNav).filter(x => x === l).length === 1 && navOrder(blotterNav).filter(x => x === l).length === 1)
  && navOrder(vawcNav)[navOrder(vawcNav).indexOf('Case Classification') + 1] === 'Hearings' && navOrder(blotterNav)[navOrder(blotterNav).indexOf('Case Classification') + 1] === 'Hearings',
  navOrder(vawcNav).join() + ' | ' + navOrder(blotterNav).join());
ok('the VAWC sidebar opens /vawc/hearings and shows no "Appointments" item', vawcNav.includes("path: '/vawc/hearings'") && !navOrder(vawcNav).some(l => /appointment/i.test(l)));
ok('the blotter sidebar never links the VAWC module', !blotterNav.includes('/vawc/'));
ok('old /vawc/appointments links redirect to /vawc/hearings', /redirect\(.*\/vawc\/hearings/.test(read('app/vawc/appointments/page.tsx')) && /redirect\('\/vawc\/hearings\/calendar'\)/.test(read('app/vawc/appointments/calendar/page.tsx')));
// The officer screens say "hearing"; the resident's own page keeps "appointment" (its notices stay plain).
ok('no officer screen still says "appointment"', ['VawcAppointments.tsx', 'AppointmentCalendar.tsx', 'CreateAppointmentDialog.tsx', 'AppointmentDetailsDialog.tsx', 'VawcAppointmentsPanel.tsx']
  .every(f => !/>[^<>{};=()]*\bappointments?\b[^<>{};=()]*</i.test(read(`components/vawcAppointments/${f}`))
    && !/(label|title|helperText|placeholder|button|done)="[^"]*\bappointments?\b/i.test(read(`components/vawcAppointments/${f}`))
    && !/toast\.(success|error)\('[^']*\bappointments?\b/i.test(read(`components/vawcAppointments/${f}`))));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
