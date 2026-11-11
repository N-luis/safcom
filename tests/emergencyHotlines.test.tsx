/**
 * The landing page's Emergency Hotlines, as rendered: every number exactly as
 * given, one copy button each, three big buttons, and no click-to-call.
 * Run with:  npm run test:hotlines      No database. Public numbers only.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import EmergencyHotlines from '../components/landing/EmergencyHotlines';
import { EMERGENCY_HOTLINES, QUICK_HOTLINES } from '../lib/emergencyHotlines';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const EXPECTED: [string, string[]][] = [
  ['Barangay Office', ['0922-709-0700']],
  ['PNP Bocaue', ['0998-598-5376', '(044) 309-3314']],
  ['Bureau of Fire Protection', ['0917-804-6722', '0947-732-5198']],
  ['Bocaue Water District', ['0933-829-5903', '(044) 692-1659']],
  ['Bocaue Rescue / Ambulance', ['0936-330-9020']],
  ['Philippine Red Cross', ['(044) 662-5922']],
  ['Meralco', ['0917-551-6211', '0920-971-6211']],
];
const QUICK = [['Police', 'PNP Bocaue', '0998-598-5376'], ['Fire', 'Bureau of Fire Protection', '0917-804-6722'], ['Rescue', 'Bocaue Rescue / Ambulance', '0936-330-9020']];

const numbers = EXPECTED.flatMap(([, n]) => n);
ok('the data is exactly the seven contacts and eleven numbers, in order', JSON.stringify(EMERGENCY_HOTLINES.map(h => [h.name, h.numbers])) === JSON.stringify(EXPECTED));
ok('no number is listed twice in the data', new Set(numbers).size === 11);
ok('agency names are in normal case, not all caps', EMERGENCY_HOTLINES.every(h => h.name !== h.name.toUpperCase()));
ok('the three big buttons are police, fire and rescue, in that order', JSON.stringify(QUICK_HOTLINES.map(q => [q.label, q.name, q.number])) === JSON.stringify(QUICK));

const html = renderToStaticMarkup(<EmergencyHotlines />);
const quickNumbers = new Set(QUICK.map(q => q[2]));
const quickNames = new Set(QUICK.map(q => q[1]));
ok('titled Emergency Hotlines, with the subtitle', html.includes('Emergency Hotlines') && html.includes('Tap a number to copy'));
ok('every contact name is shown in the list; the big three also on their button', EXPECTED.every(([name]) => count(html, `>${name}<`) === (quickNames.has(name) ? 2 : 1)));
ok('every number is shown as written; the big three also on their button', numbers.every(n => count(html, `>${n}<`) === (quickNumbers.has(n) ? 2 : 1)), numbers.filter(n => count(html, `>${n}<`) < 1).join());
ok('one copy button per number, each naming only its own number', EXPECTED.every(([name, list]) => list.every(n => html.includes(`aria-label="Copy ${name} number ${n}"`))));
ok('the big buttons copy their own number', QUICK.every(([label, name, n]) => html.includes(`aria-label="Copy ${label}, ${name}, number ${n}"`)));
ok('15 buttons: 3 big, 1 toggle, 11 in the list', count(html, '<button') === 15, String(count(html, '<button')));
ok('the toggle starts collapsed and says what it controls', html.includes('aria-expanded="false"') && html.includes('aria-controls=') && html.includes('View all hotlines'));
ok('no click-to-call: no links at all', !/tel:/i.test(html) && !html.includes('<a '));
ok('nothing says copied before a click', !html.includes('Copied'));

const page = fs.readFileSync('app/login/page.tsx', 'utf8');
ok('the landing page shows the panel', page.includes('<EmergencyHotlines />'));
ok('Sign In and Create Account are still wired up', page.includes("onClick={() => setLoginOpen(true)} endIcon={<ArrowForward />}") && count(page, "router.push('/register')") === 2);
const source = fs.readFileSync('components/landing/EmergencyHotlines.tsx', 'utf8');
ok('numbers live only in the data file', !/\d{4}-\d{3}-\d{4}/.test(source) && !/\d{4}-\d{3}-\d{4}/.test(page));
ok('no emergency banner was added above the page', !/banner|strip/i.test(page));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
