/**
 * The email settings as pasted into a hosting dashboard, and the /auth/confirm link router.
 *   npx tsx tests/emailSettings.test.ts
 * No network, no email sent: settings are read from process.env, set here per case.
 */
import { NextRequest } from 'next/server';
import { settings, emailSettingsReport } from '../lib/email';
import { GET as confirmGET } from '../app/auth/confirm/route';

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fails.push(name); console.log('  FAIL  ' + name + (detail ? ` (${detail})` : '')); } };

const KEYS = ['EMAIL_SERVER', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'EMAIL_FROM'] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
function withEnv(env: Partial<Record<typeof KEYS[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}
const GMAIL = { EMAIL_USERNAME: 'probe.sender@gmail.com', EMAIL_PASSWORD: 'abcd efgh ijkl mnop' };

console.log('Server name as pasted');
const cases: [string, string, string][] = [
  ['exactly smtp.gmail.com', 'smtp.gmail.com', 'smtp.gmail.com'],
  ['with https:// and a port', 'https://smtp.gmail.com:465/', 'smtp.gmail.com'],
  ['in quotes, with a line break', '"smtp.gmail.com"\n', 'smtp.gmail.com'],
  ['the mailbox domain gmail.com', 'gmail.com', 'smtp.gmail.com'],
  ['the word Gmail', 'Gmail', 'smtp.gmail.com'],
  ['the Gmail address itself', 'probe.sender@gmail.com', 'smtp.gmail.com'],
  ['a space inside', 'smtp. gmail.com', 'smtp.gmail.com'],
  ['empty, the username a Gmail address', '', 'smtp.gmail.com'],
  ['not a server name at all', 'my password 123', 'smtp.gmail.com'],
  ['Brevo by name', 'brevo', 'smtp-relay.brevo.com'],
  ['another provider\'s server, kept', 'smtp.office365.com', 'smtp.office365.com'],
];
for (const [label, value, want] of cases) {
  withEnv({ ...GMAIL, EMAIL_SERVER: value });
  ok(`${label} -> ${want}`, settings().host === want, settings().host);
}
withEnv({ ...GMAIL, EMAIL_SERVER: 'smtp.gmail.com' });
ok('Gmail: the app password used without its spaces; port 465 when none is set', settings().pass === 'abcdefghijklmnop' && settings().port === 465);
withEnv({ ...GMAIL, EMAIL_SERVER: 'smtp.gmail.com', EMAIL_PORT: ' 587 ' });
ok('EMAIL_PORT with spaces: 587', settings().port === 587);
withEnv({ ...GMAIL, EMAIL_SERVER: 'gmail.com' });
ok('the report says what was corrected', /mailbox domain/.test(emailSettingsReport().serverCorrected ?? ''), emailSettingsReport().serverCorrected ?? 'none');

console.log('\nThe report: categories only');
withEnv({ EMAIL_SERVER: 'smtp.gmail.com', EMAIL_USERNAME: 'probesender', EMAIL_PASSWORD: 'MyNormalPassword!1', EMAIL_FROM: 'SafeComm <someone.else@gmail.com>' });
const r = emailSettingsReport();
const text = JSON.stringify(r);
ok('a username that is not an address, a normal (not app) password, a different sender: each named', r.problems.some(p => /full Gmail address/.test(p))
  && r.problems.some(p => /app password/.test(p)) && r.problems.some(p => /EMAIL_FROM is not/.test(p)), r.problems.join(' | '));
ok('never the password, the username or the sender address', !/MyNormalPassword|probesender|someone\.else/.test(text));
withEnv({ EMAIL_SERVER: 'secretpassword', EMAIL_USERNAME: 'x', EMAIL_PASSWORD: 'y' });
ok('whatever was typed as the server is not shown unless it is a mail server\'s name', !/secretpassword/.test(JSON.stringify(emailSettingsReport())), JSON.stringify(emailSettingsReport()));
withEnv({ EMAIL_SERVER: 'smtp.gmail.com', ...GMAIL, EMAIL_FROM: 'SafeComm <probe.sender@gmail.com>' });
ok('correct Gmail settings: no problems', emailSettingsReport().problems.length === 0, emailSettingsReport().problems.join(' | '));
withEnv({ EMAIL_SERVER: 'smtp.gmail.com', ...GMAIL, EMAIL_FROM: 'onboarding@resend.dev' });
ok('a test sender is named as a problem', emailSettingsReport().problems.some(p => /test sender/.test(p)));

console.log('\n/auth/confirm: SafeComm pages only');
const at = (q: string) => {
  const res = confirmGET(new NextRequest(`https://barangaysafcom.vercel.app/auth/confirm${q}`));
  return new URL(res.headers.get('location')!);
};
const T = 'pkce_0123456789abcdef0123456789abcdef';
let u = at(`?token_hash=${T}&type=recovery&next=https://evil.example/x&redirect_to=https://evil.example`);
ok('a recovery link -> /reset-password with its token; "next" and "redirect_to" ignored', u.origin === 'https://barangaysafcom.vercel.app' && u.pathname === '/reset-password'
  && u.searchParams.get('token_hash') === T && u.searchParams.get('type') === 'recovery' && !u.search.includes('evil'), u.href);
u = at(`?token_hash=${T}&type=invite`);
ok('a set-up (invite) link -> /reset-password, type invite', u.pathname === '/reset-password' && u.searchParams.get('type') === 'invite');
u = at(`?token_hash=${T}&type=email`);
ok('an email confirmation (signup / email) -> /verify-email', u.pathname === '/verify-email' && u.searchParams.get('type') === 'signup');
u = at(`?token_hash=${T}&type=magiclink`);
ok('a resent confirmation (magic link) -> /verify-email, type magiclink', u.pathname === '/verify-email' && u.searchParams.get('type') === 'magiclink');
u = at('?token_hash=<script>&type=recovery');
ok('a broken token -> Forgot Password, nothing carried over', u.pathname === '/forgot-password' && u.search === '');
u = at(`?token_hash=${T}&type=whatever`);
ok('an unknown type -> Sign In', u.pathname === '/resident-login' && u.search === '');

for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
