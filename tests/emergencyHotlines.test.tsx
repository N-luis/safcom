/**
 * The landing page's Emergency Hotlines, as rendered: every number exactly as
 * given, one copy button each, and no click-to-call.
 * Run with:  npm run test:hotlines      No database. Public numbers only.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import EmergencyHotlines from '../components/landing/EmergencyHotlines';
import { EMERGENCY_HOTLINES } from '../lib/emergencyHotlines';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const EXPECTED: [string, string[]][] = [
  ['BARANGAY OFFICE', ['0922-709-0700']],
  ['PNP BOCAUE', ['0998-598-5376', '(044) 309-3314']],
  ['BUREAU OF FIRE PROTECTION', ['0917-804-6722', '0947-732-5198']],
  ['BOCAUE WATER DISTRICT', ['0933-829-5903', '(044) 692-1659']],
  ['BOCAUE RESCUE / AMBULANCE', ['0936-330-9020']],
  ['PHILIPPINE RED CROSS', ['(044) 662-5922']],
  ['MERALCO', ['0917-551-6211', '0920-971-6211']],
];

const numbers = EXPECTED.flatMap(([, n]) => n);
ok('the data is exactly the seven contacts and eleven numbers, in order', JSON.stringify(EMERGENCY_HOTLINES.map(h => [h.name, h.numbers])) === JSON.stringify(EXPECTED));
ok('no number is listed twice', new Set(numbers).size === 11);

const html = renderToStaticMarkup(<EmergencyHotlines />);
ok('titled Emergency Hotlines', html.includes('Emergency Hotlines'));
ok('every contact name is shown once', EXPECTED.every(([name]) => count(html, `>${name}<`) === 1));
ok('every number is shown once, as written', numbers.every(n => count(html, `>${n}<`) === 1), numbers.filter(n => count(html, `>${n}<`) !== 1).join());
ok('one copy button per number, each naming only its own number', count(html, '<button') === 11 && EXPECTED.every(([name, list]) => list.every(n => html.includes(`aria-label="Copy ${name} number ${n}"`))));
ok('no click-to-call: no links at all', !/tel:/i.test(html) && !html.includes('<a '));
ok('nothing says copied before a click', !html.includes('Copied!'));

const page = fs.readFileSync('app/login/page.tsx', 'utf8');
ok('the landing page shows the panel', page.includes('<EmergencyHotlines />'));
ok('Sign In and Create Account are still wired up', page.includes("onClick={() => setLoginOpen(true)} endIcon={<ArrowForward />}") && count(page, "router.push('/register')") === 2);
const source = fs.readFileSync('components/landing/EmergencyHotlines.tsx', 'utf8');
ok('numbers live only in the data file', !/\d{4}-\d{3}-\d{4}/.test(source) && !/\d{4}-\d{3}-\d{4}/.test(page));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
