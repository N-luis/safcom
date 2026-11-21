/**
 * Emergency Hotlines on the Resident Dashboard: every configured hotline with
 * its own Call Now (a tel: link to that very number) and Copy; no link for a
 * number that cannot be dialled; gone from File a Report; Case Distribution
 * gone from the resident dashboard only.
 * Run with:  npm run test:residenthotlines      No database. Public numbers only.
 *
 * What a phone does with a tel: link (opening its dialer) cannot be tested
 * here - see the browser check and the report for what was and was not tried.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ResidentHotlines from '../components/dashboard/ResidentHotlines';
import ReportSidePanel from '../components/forms/ReportSidePanel';
import { EMERGENCY_HOTLINES, telHref } from '../lib/emergencyHotlines';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

console.log('\nThe call links');
ok('a mobile number: +63 and the 10 digits', telHref('0922-709-0700') === 'tel:+639227090700');
ok('a landline with its area code: +63 44 ...', telHref('(044) 309-3314') === 'tel:+63443093314');
ok('a number already in +63 form is kept', telHref('+63 917 804 6722') === 'tel:+639178046722');
ok('an extension is dialled after a pause', telHref('(044) 309-3314 loc. 12') === 'tel:+63443093314,12');
ok('the short national emergency codes as they are', telHref('911') === 'tel:911' && telHref('117') === 'tel:117');
ok('nothing dialable: no link (letters, too short, empty, a stray symbol)', [null, '', 'call the hall', '12345', '0922-709-07000000', '0922#7090700'].every(n => telHref(n) === null));

console.log('\nThe dashboard card');
const html = unescape(renderToStaticMarkup(<ResidentHotlines />));
const all = EMERGENCY_HOTLINES.flatMap(h => h.numbers.map(n => ({ name: h.name, n })));
ok('titled Emergency Hotlines', html.includes('>Emergency Hotlines<'));
ok('every configured hotline name is shown once', EMERGENCY_HOTLINES.every(h => count(html, `>${h.name}<`) === 1));
ok('every number is shown exactly as written', all.every(({ n }) => html.includes(`>${n}<`)), all.filter(({ n }) => !html.includes(`>${n}<`)).map(x => x.n).join());
ok('one Call Now per number, each linking to its own number', all.every(({ name, n }) => {
  const m = new RegExp(`<a[^>]*href="([^"]+)"[^>]*aria-label="Call Now: ${name.replace(/[/]/g, '\\/')}, ${n.replace(/[()]/g, '\\$&')}"`).exec(html);
  return Boolean(m && m[1] === telHref(n));
}), 'a Call Now link does not match its number');
ok(`${all.length} Call Now links in all, no other links`, count(html, 'Call Now: ') === all.length && count(html, '<a ') === all.length && count(html, 'href="tel:') === all.length);
ok('no two rows share a number (no duplicate entries)', new Set(all.map(x => x.n)).size === all.length);
ok('a Copy button for every number', all.every(({ name, n }) => html.includes(`aria-label="Copy ${name} number ${n}"`)));
ok('no fake call result: nothing says calling, connected or call made', !/calling\b|connected|call (was )?made|call placed/i.test(html.replace(/calling app/g, '')));
const bad = unescape(renderToStaticMarkup(<ResidentHotlines hotlines={[{ name: 'Test Office', numbers: ['not a number', '0922-709-0700'] }]} />));
ok('a number that cannot be dialled gets no link - shown to copy instead', !bad.includes('Call Now: Test Office, not a number') && bad.includes('>not a number<')
  && bad.includes('Cannot be dialled from here') && bad.includes('href="tel:+639227090700"') && count(bad, '<a ') === 1);

console.log('\nWhere it is shown');
const panel = renderToStaticMarkup(<ReportSidePanel />);
const panelSrc = fs.readFileSync('components/forms/ReportSidePanel.tsx', 'utf8');
ok('File a Report: no Emergency Hotlines any more', !panel.includes('Emergency Hotlines') && !panelSrc.includes('EmergencyHotlines') && !all.some(({ n }) => panel.includes(n)));
ok('...and the rest of its side panel is still there', panel.includes('What happens after you submit'));
const dash = fs.readFileSync('app/resident/page.tsx', 'utf8');
ok('Resident Dashboard: Emergency Hotlines, in place of Case Distribution', dash.includes('<ResidentHotlines />') && !/Case Distribution|DonutBreakdown|donutData/.test(dash));
ok('...its statistics, Recent Reports and Latest Updates are still there', dash.includes('statCards') && dash.includes('Recent Reports') && dash.includes('Latest Updates'));
ok('the residency gate (an unverified resident\'s dashboard) shows the hotlines too', fs.readFileSync('components/residency/ResidencyGate.tsx', 'utf8').includes("page === 'dashboard' && <ResidentHotlines />"));
ok('the case distribution charts for officials are untouched (the chart component is still used there)', fs.existsSync('components/charts/DonutBreakdown.tsx'));
ok('numbers live only in the data file, not in the card', !/\d{4}-\d{3}-\d{4}/.test(fs.readFileSync('components/dashboard/ResidentHotlines.tsx', 'utf8')));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
