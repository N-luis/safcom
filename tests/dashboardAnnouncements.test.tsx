/**
 * Announcements on the officials' dashboards: publishing from a dashboard
 * opens that module's Announcements page, and each dashboard shows the live
 * posts. Run with:  npm run test:dashboardannouncements     No database.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SWRConfig } from 'swr';
import DashboardAnnouncements from '../components/announcements/DashboardAnnouncements';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const read = (f: string) => fs.readFileSync(f, 'utf8');
/** The visible text of rendered markup, for failure messages. */
const textOf = (h: string) => h.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Wiring
const blotter = read('app/blotter-officer/page.tsx'), vawc = read('app/vawc/page.tsx');
ok('Blotter dashboard: Announce opens the Blotter board', blotter.includes('<AnnounceButton accent="#3b82f6" boardPath="/blotter-officer/reports" />'));
ok('VAWC dashboard: Announce opens the VAWC board', vawc.includes('<AnnounceButton accent="#7c3aed" boardPath="/vawc/announcements" />'));
ok('both dashboards show the announcements card', blotter.includes('<DashboardAnnouncements accent="#3b82f6" boardPath="/blotter-officer/reports" />')
  && vawc.includes('<DashboardAnnouncements accent="#7c3aed" boardPath="/vawc/announcements" />'));
ok('VAWC has its own Announcements page and sidebar entry', fs.existsSync('app/vawc/announcements/page.tsx') && read('app/vawc/announcements/page.tsx').includes('<AnnouncementsPanel')
  && read('app/vawc/layout.tsx').includes("path: '/vawc/announcements'"));
ok('the VAWC board is not duplicated on Reports', !read('app/vawc/reports/page.tsx').includes('AnnouncementsPanel'));
const button = read('components/announcements/AnnounceButton.tsx');
ok('after publishing, the officer is taken to the new post', button.includes('router.push(created?.id ? `${boardPath}?new=${encodeURIComponent(created.id)}` : boardPath)'));
ok('the captain dashboard keeps its button as it was (no board to open)', read('app/dashboard/page.tsx').includes('<AnnounceButton accent={ACCENT} />'));
ok('the dialog hands back the post it created', read('components/announcements/ComposeAnnouncementDialog.tsx').includes('onPublished(json.data as Announcement);'));
ok('the board highlights ?new and then cleans the address', read('components/announcements/AnnouncementsPanel.tsx').includes("get('new')")
  && read('components/announcements/AnnouncementsPanel.tsx').includes('window.history.replaceState'));

// The card, rendered with fictional posts
const now = Date.now();
const post = (id: string, title: string, level: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
  ({ id, title, message: `${title} details`, level, active: true, expired: false, audience: 'residents', audienceModule: null, barangay: null, module: 'blotter',
    createdBy: 'Probe', createdAt: new Date(now - minutesAgo * 60_000).toISOString(), expiresAt: null, ...extra });
const render = (data: unknown[]) => renderToStaticMarkup(
  <SWRConfig value={{ fallback: { '/api/alerts': data }, provider: () => new Map() }}>
    <DashboardAnnouncements accent="#3b82f6" boardPath="/blotter-officer/reports" />
  </SWRConfig>);
const html = render([post('a', 'Typhoon Signal No. 2', 'critical', 5), post('b', 'Fiesta Saturday', 'info', 60), post('c', 'Road closure', 'warning', 120),
  post('d', 'Fourth post', 'info', 300), post('e', 'Taken down post', 'info', 1, { active: false }), post('f', 'Expired post', 'info', 2, { expired: true })]);
ok('shows the three newest live posts, with title, level and message', ['Typhoon Signal No. 2', 'Fiesta Saturday', 'Road closure', 'Critical', 'Info', 'Warning', 'Road closure details'].every(t => html.includes(t))
  && !html.includes('Fourth post'), textOf(html));
ok('taken-down and expired posts are not shown', !html.includes('Taken down post') && !html.includes('Expired post'));
ok('counts the live posts', html.includes('4 live'));
ok('has View all', html.includes('View all'));
ok('says so when there are none', render([]).includes('No live announcements') && render([]).includes('0 live'), textOf(render([])));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
