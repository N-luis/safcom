/**
 * "About what time?" - the values the picker produces, and what the form and
 * the server accept. Pure - no database.
 *   npm run test:incidenttime
 */
import {
  TIME_PERIODS, HOURS_12, MINUTES_5, isIncidentTime, parseExactTime, formatExactTime, startMinutes, isFutureIncidentTime, nowInPh,
} from '../lib/incidentTime';

let passed = 0, failed = 0;
const fails: string[] = [];
const ok = (name: string, v: boolean, extra = '') => {
  if (v) passed++; else { failed++; fails.push(name); }
  console.log(`  ${v ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

console.log('What the picker offers');
ok('six parts of the day, midnight to midnight, in order', TIME_PERIODS.length === 6 && TIME_PERIODS[0].startHour === 0
  && TIME_PERIODS.every((p, i) => i === 0 || p.startHour > TIME_PERIODS[i - 1].startHour));
ok('hours 1 to 12', HOURS_12.join() === '1,2,3,4,5,6,7,8,9,10,11,12');
ok('minutes in steps of 5', MINUTES_5.join() === '00,05,10,15,20,25,30,35,40,45,50,55');
ok('every stored value fits the 60-character column', TIME_PERIODS.every(p => p.value.length <= 60));

console.log('\nWhat is accepted');
ok('not sure (empty)', isIncidentTime('') && isIncidentTime(undefined));
ok('each part of the day', TIME_PERIODS.every(p => isIncidentTime(p.value)));
ok('an exact time', isIncidentTime('9:05 PM') && isIncidentTime('12:00 AM') && isIncidentTime('11:55 AM'));
ok('typed text is refused', !isIncidentTime('mga alas-dos ng madaling araw') && !isIncidentTime('around 9'));
ok('a half-chosen exact time is refused', !isIncidentTime('?:05 PM') && !isIncidentTime('9:05 ?'));
ok('impossible times are refused', !isIncidentTime('13:00 PM') && !isIncidentTime('0:30 AM') && !isIncidentTime('9:60 PM') && !isIncidentTime('21:00'));

console.log('\nReading a time');
ok('parts round-trip', formatExactTime(parseExactTime('9:05 PM')!) === '9:05 PM');
ok('12 AM is midnight', startMinutes('12:00 AM') === 0);
ok('12 PM is noon', startMinutes('12:30 PM') === 12 * 60 + 30);
ok('9:05 PM is 21:05', startMinutes('9:05 PM') === 21 * 60 + 5);
ok('a part of the day starts at its first hour', startMinutes('Evening (6 PM - 9 PM)') === 18 * 60);

console.log('\nNot later than now, when the date is today (Philippine time)');
// 2026-11-05 15:00 in Manila = 07:00 UTC.
const at3pm = Date.parse('2026-11-05T07:00:00Z');
ok('PH "now" is read in Manila time', nowInPh(at3pm).date === '2026-11-05' && nowInPh(at3pm).minutes === 15 * 60);
ok('today, 9:05 PM, at 3 PM: refused', isFutureIncidentTime('2026-11-05', '9:05 PM', at3pm));
ok('today, evening, at 3 PM: refused', isFutureIncidentTime('2026-11-05', 'Evening (6 PM - 9 PM)', at3pm));
ok('today, 2:30 PM, at 3 PM: fine', !isFutureIncidentTime('2026-11-05', '2:30 PM', at3pm));
ok('today, afternoon (started 1 PM), at 3 PM: fine', !isFutureIncidentTime('2026-11-05', 'Afternoon (1 PM - 6 PM)', at3pm));
ok('a few minutes ahead (phone clock): fine', !isFutureIncidentTime('2026-11-05', '3:05 PM', at3pm));
ok('yesterday, 9:05 PM: fine', !isFutureIncidentTime('2026-11-04', '9:05 PM', at3pm));
ok('no date: fine', !isFutureIncidentTime('', '9:05 PM', at3pm));
// 2026-11-05 00:30 Manila = 2026-11-04 16:30 UTC: the UTC date is still the 4th.
const justAfterMidnight = Date.parse('2026-11-04T16:30:00Z');
ok('just after midnight, "today" is already the 5th in Manila', isFutureIncidentTime('2026-11-05', '9:00 AM', justAfterMidnight)
  && !isFutureIncidentTime('2026-11-05', '12:15 AM', justAfterMidnight));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
