import nodemailer from 'nodemailer';

/**
 * SafeComm's mailer (SMTP). Sends the sign-in emails Supabase Auth's links are
 * carried in - confirm the email, reset the password, set up a password for an
 * account from before - and the residency notices.
 *
 * The settings are read when a message is sent, not when the module loads.
 * A link is never written to the log, whatever happens: it signs someone in.
 */
/** A value as pasted into a hosting dashboard: surrounding spaces, line breaks and quotes removed. */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();

/**
 * The SMTP settings, forgiving of how they were pasted: "https://smtp.gmail.com:465/" is read as the
 * host smtp.gmail.com (and port 465 when EMAIL_PORT is not set), and a Gmail app password shown as
 * "abcd efgh ijkl mnop" is used without its spaces (an app password has none).
 */
/** Mailbox providers whose SMTP server is known: a mailbox domain (or its name alone) → the server. */
const PROVIDER_SMTP: Record<string, string> = {
  'gmail.com': 'smtp.gmail.com', 'googlemail.com': 'smtp.gmail.com', gmail: 'smtp.gmail.com', google: 'smtp.gmail.com',
  'yahoo.com': 'smtp.mail.yahoo.com', yahoo: 'smtp.mail.yahoo.com',
  'icloud.com': 'smtp.mail.me.com', 'me.com': 'smtp.mail.me.com', icloud: 'smtp.mail.me.com',
  'zoho.com': 'smtp.zoho.com', zoho: 'smtp.zoho.com',
  'brevo.com': 'smtp-relay.brevo.com', brevo: 'smtp-relay.brevo.com', 'sendinblue.com': 'smtp-relay.brevo.com',
  'resend.com': 'smtp.resend.com', resend: 'smtp.resend.com',
  'sendgrid.com': 'smtp.sendgrid.net', 'sendgrid.net': 'smtp.sendgrid.net', sendgrid: 'smtp.sendgrid.net',
};
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Which server to use, and what was wrong with EMAIL_SERVER as written (a category, never the
 * value): a mailbox address or a mailbox domain ("gmail.com") instead of its SMTP server, or
 * no usable server name at all - then, when EMAIL_USERNAME is a mailbox at a known provider
 * (a Gmail address: smtp.gmail.com), that provider's server.
 */
function resolveHost(raw: string, user: string): { host: string; fixed: string | null } {
  let h = raw.toLowerCase();
  const fromUser = PROVIDER_SMTP[(user.split('@')[1] ?? '').toLowerCase()];
  if (!h) return fromUser ? { host: fromUser, fixed: 'empty - used the server of the username\'s provider' } : { host: '', fixed: null };
  if (h.includes('@')) {
    const known = PROVIDER_SMTP[h.split('@').pop()!];
    if (known || fromUser) return { host: known ?? fromUser, fixed: 'an email address, not a server name - used its provider\'s server' };
  }
  h = h.replace(/\s+/g, '');
  if (PROVIDER_SMTP[h]) return { host: PROVIDER_SMTP[h], fixed: `the provider's ${h.includes('.') ? 'mailbox domain' : 'name'}, not its SMTP server - used its SMTP server` };
  if (!HOSTNAME.test(h)) return fromUser ? { host: fromUser, fixed: 'not a server name - used the server of the username\'s provider' } : { host: h, fixed: null };
  return { host: h, fixed: raw.toLowerCase() !== h ? 'had spaces inside - removed' : null };
}

/** A sender address that is still a template's example. */
const PLACEHOLDER = /@(yourdomain|your-domain|example|domain)\.(com|org|net)\b|@yourcompany\./i;

/**
 * The From line: EMAIL_FROM when it holds a real address; otherwise (empty, a template's example such
 * as you@yourdomain.com, or no address in it) "SafeComm <EMAIL_USERNAME>" when the username is an
 * address - what Gmail and most providers require anyway.
 */
function senderFor(from: string, user: string): string {
  const addr = /[^\s<>@"']+@[^\s<>@"']+\.[a-z]{2,}/i.exec(from)?.[0];
  if (addr && !PLACEHOLDER.test(addr)) return /<[^>]+>/.test(from) ? from : `SafeComm <${addr}>`;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(user)) return `SafeComm <${user}>`;
  return from || 'SafeComm <no-reply@safcom.gov.ph>';
}

export function settings() {
  let host = clean(process.env.EMAIL_SERVER).replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  let portFromHost: number | null = null;
  const m = /^(.*):(\d{2,5})$/.exec(host);
  if (m) { host = m[1]; portFromHost = Number(m[2]); }
  const user = clean(process.env.EMAIL_USERNAME);
  const resolved = resolveHost(host, user);
  // A port is 1-65535; anything else in EMAIL_PORT (another setting pasted there) is ignored, and reported.
  const portText = clean(process.env.EMAIL_PORT);
  const portValid = /^\d{1,5}$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535;
  const port = portValid ? Number(portText) : portFromHost ?? (resolved.host === 'smtp.gmail.com' ? 465 : 587);
  const gmail = resolved.host === 'smtp.gmail.com';
  const pass = clean(process.env.EMAIL_PASSWORD);
  return {
    from: senderFor(clean(process.env.EMAIL_FROM), user),
    host: resolved.host,
    hostFixed: resolved.fixed,
    port,
    portIgnored: Boolean(portText) && !portValid,
    user,
    // A Google app password is shown as "abcd efgh ijkl mnop"; the spaces are not part of it.
    pass: gmail ? pass.replace(/\s+/g, '') : pass,
  };
}

/**
 * What is wrong with the email settings, in categories only - safe for /api/health: never a
 * password, a username or a full address. The server name is shown only when it is a public
 * provider's server (smtp.gmail.com and the like), which is not a secret.
 */
function kindOf(v: string | undefined): string {
  const t = clean(v);
  if (!t) return 'empty';
  if (/^[a-z][a-z0-9+.-]*:\/\/[^\s/]*@/i.test(t)) return `a ${t.split(':')[0].toLowerCase()}:// address with a login inside it (not used - put each part in its own setting)`;
  const addr = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(t)?.[1] ?? (/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(t) ? t : null);
  if (addr) return `${/</.test(t) ? 'a name and email address' : 'an email address'} at ${addr.split('@')[1].toLowerCase()}`;
  const inside = /[^\s<>@"']+@([^\s<>@"']+\.[a-z]{2,})/i.exec(t);
  if (inside) return `text with an email address at ${inside[1].toLowerCase()}, not in the form Name <address>`;
  if (/^\d{1,5}$/.test(t) && Number(t) <= 65535) return `a port number (${t})`;
  if (/^\d+$/.test(t)) return `a long number (${t.length} digits) - not a port`;
  const host = t.replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '').toLowerCase();
  if (HOSTNAME.test(host) && /^(smtp|smtps|mail|smtp-relay|smtp-mail|email-smtp)[.-]/.test(host)) return `a mail server name (${host})`;
  if (HOSTNAME.test(host)) return 'a domain or server name';
  if (/^[a-z]{4}( ?[a-z]{4}){3}$/i.test(t)) return 'a Google app password (16 letters)';
  return `other text (${t.length} characters${/\s/.test(t) ? ', with spaces or line breaks' : ''}${formatOf(t)})`;
}

/** The format of an unrecognised value - so a whole block or another service's key pasted in shows - never its content. */
function formatOf(t: string): string {
  const f: string[] = [];
  if (/EMAIL_(SERVER|PORT|USERNAME|PASSWORD|FROM)\s*=/i.test(t)) f.push('contains NAME=value lines of the email settings themselves');
  else if (/^[A-Z][A-Z0-9_]{2,}\s*=/.test(t)) f.push('starts like NAME=value');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) f.push(`a ${t.split(':')[0].toLowerCase()}:// address`);
  if (/^re_[A-Za-z0-9_]{10,}$/.test(t)) f.push('a Resend API key');
  else if (/^xkeysib-/.test(t)) f.push('a Brevo API key');
  else if (/^SG\.[\w-]+\.[\w-]+$/.test(t)) f.push('a SendGrid API key');
  else if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) f.push('a token (JWT) - such as a Supabase key');
  else if (/^sb_(secret|publishable)_/.test(t)) f.push('a Supabase key');
  else if (/^gsk_/.test(t)) f.push('a Groq API key');
  else if (/^postgres(ql)?:\/\//i.test(t)) f.push('a database address');
  else if (/^[a-f0-9]+$/i.test(t)) f.push('hexadecimal');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) f.push('random-looking letters and digits');
  return f.length ? `; looks like ${f.join(', ')}` : '';
}

export function emailSettingsReport() {
  const s = settings();
  const raw = clean(process.env.EMAIL_SERVER);
  // A mail server's name is not a secret; anything else that was typed there (it could be a password) is never shown.
  const publicServer = HOSTNAME.test(s.host) && (Object.values(PROVIDER_SMTP).includes(s.host)
    || /^(smtp|smtps|mail|smtp-relay|smtp-mail|email-smtp)[.-]/.test(s.host) || /gmail|google|yahoo|outlook|office365|brevo|sendgrid|resend|zoho|mailgun|amazonaws/.test(s.host));
  const fromAddr = (/<([^>]+)>/.exec(s.from)?.[1] ?? s.from).trim().toLowerCase();
  const problems: string[] = [];
  if (!raw && !s.host) problems.push('EMAIL_SERVER is empty');
  else if (!HOSTNAME.test(s.host)) problems.push('EMAIL_SERVER is not a server name (for Gmail it must be exactly smtp.gmail.com)');
  if (!s.user) problems.push('EMAIL_USERNAME is empty');
  else if (s.host === 'smtp.gmail.com' && !/@/.test(s.user)) problems.push('EMAIL_USERNAME must be the full Gmail address (name@gmail.com)');
  if (!s.pass) problems.push('EMAIL_PASSWORD is empty');
  else if (s.host === 'smtp.gmail.com' && !/^[a-z]{16}$/i.test(s.pass)) problems.push('EMAIL_PASSWORD does not look like a Google app password (16 letters) - Gmail refuses the normal account password');
  if (PLACEHOLDER.test(clean(process.env.EMAIL_FROM))) problems.push(`EMAIL_FROM is still a template's example address - ${/@/.test(s.user) ? 'EMAIL_USERNAME is used instead' : 'set it to SafeComm <your sending address>'}`);
  if (isEmailTestSender()) problems.push('EMAIL_FROM is a test sender that only delivers to the provider account owner');
  if (s.host === 'smtp.gmail.com' && s.user && fromAddr && fromAddr !== s.user.toLowerCase()) {
    problems.push('EMAIL_FROM is not the Gmail address in EMAIL_USERNAME - Gmail replaces it unless it is a verified "Send mail as" address');
  }
  if (new Set((['EMAIL_SERVER', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'EMAIL_FROM'] as const).map(k => clean(process.env[k]))).size === 1 && raw) {
    problems.unshift('All five EMAIL_* settings hold the same value - each needs its own (server, port, username, app password, sender)');
  }
  if (s.portIgnored) problems.push(`EMAIL_PORT is not a port number (it was ignored - ${s.port} used): set it to 465, or 587`);
  return {
    server: !s.host ? 'none' : publicServer ? s.host : 'custom server',
    // What kind of value each setting holds - so a value pasted into the wrong one shows - never the value.
    holds: Object.fromEntries((['EMAIL_SERVER', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'EMAIL_FROM'] as const).map(k => [k, kindOf(process.env[k])])),
    // The same value pasted into every setting.
    allTheSame: new Set((['EMAIL_SERVER', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD', 'EMAIL_FROM'] as const).map(k => clean(process.env[k]))).size === 1 && Boolean(clean(process.env.EMAIL_SERVER)),
    port: s.port,
    serverCorrected: s.hostFixed,
    problems,
  };
}

export function isEmailConfigured(): boolean {
  const s = settings();
  return Boolean(s.host && s.user && s.pass);
}

/**
 * Whether the sender is a provider's test sender, which only delivers to the
 * provider account's owner (Resend: onboarding@resend.dev). Residents then
 * receive nothing - said on /api/health and to everyone who asks for a link.
 */
export function isEmailTestSender(): boolean {
  return /@resend\.dev\b/i.test(settings().from);
}

/** Whether residents can actually receive SafeComm's emails (set up, and not a test sender). */
export const emailDeliverable = () => isEmailConfigured() && !isEmailTestSender();

/** Said to everyone who asks for an emailed link while delivery is not set up - never per account. */
export const EMAIL_NOT_DELIVERABLE = 'SafeComm cannot send emails to residents yet. Please contact the barangay office for help with your account.';

/**
 * Whether the mail server accepts SafeComm's login - checked without sending
 * anything, at most once every 5 minutes. A category only, never the server's
 * text (it can carry an address): ok | login_rejected | unreachable | not_configured.
 */
let loginCheck: { at: number; result: string } | null = null;
export async function emailLoginStatus(): Promise<string> {
  if (!isEmailConfigured()) return 'not_configured';
  if (loginCheck && Date.now() - loginCheck.at < 5 * 60_000) return loginCheck.result;
  const s = settings();
  let result = 'ok';
  try {
    await nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000 }).verify();
  } catch (e) {
    const err = e as { message?: string; code?: string; responseCode?: number };
    const msg = err.message ?? String(e);
    // The category, with nodemailer's code and the server's reply number (never its text).
    const code = [err.code, err.responseCode].filter(Boolean).join(' ');
    const cat = /\b535\b|invalid login|username and password/i.test(msg) || err.code === 'EAUTH' ? 'login_rejected'
      : /missing credentials/i.test(msg) ? 'credentials_missing'
        : /timeout|ETIMEDOUT/i.test(msg + (err.code ?? '')) ? 'timeout'
          : /ENOTFOUND|EDNS|getaddrinfo/i.test(msg + (err.code ?? '')) ? 'server_name_not_found'
            : /certificate|TLS|SSL|wrong version/i.test(msg) ? 'tls_problem' : 'unreachable';
    result = code ? `${cat} (${code})` : cat;
  }
  loginCheck = { at: Date.now(), result };
  return result;
}

/**
 * Whether residents can be sent SafeComm's emails right now: set up, not a test sender, and the
 * mail server accepts the login (checked without sending, at most every 5 minutes). When it is
 * false, the pages say so to everyone who asks - the same answer for every address.
 */
export async function emailReady(): Promise<boolean> {
  if (sink) return true;
  if (!emailDeliverable()) return false;
  return (await emailLoginStatus().catch(() => 'unreachable')) === 'ok';
}

export type SendReason = 'sent' | 'not_configured' | 'sandbox_recipient_blocked' | 'send_failed';

export interface SendResult {
  ok: boolean;
  reason: SendReason;
  /** Safe to show a user; never contains credentials or a link. */
  detail?: string;
}

interface Message { to: string; subject: string; html: string; text: string }

/** Tests only: receive each message instead of sending it (no SMTP, nothing leaves the machine). */
let sink: ((m: Message) => void) | null = null;
export function setMailSinkForTests(fn: ((m: Message) => void) | null) { sink = fn; }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** One email's words: English first, then Filipino. */
interface Words { paragraphs: string[]; footnote: string }
interface Layout { name: string; en: Words; tl: Words; button: { label: string; url: string } | null }

/** The SafeComm email: navy header, the message, one teal button (with the link written out), a Filipino section, the security note. */
function template(l: Layout): string {
  const para = (p: string) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#475569;">${esc(p)}</p>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(12,30,70,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0c1e46,#071739);padding:24px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">SafeComm</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:2px;margin-top:4px;">Barangay Biñang 2nd · Community Safety</div>
        </td></tr>
        <tr><td style="padding:30px 26px 8px;">
          <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Hello <strong>${esc(l.name)}</strong>,</p>
          ${l.en.paragraphs.map(para).join('\n          ')}
          ${l.button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px auto 20px;">
            <tr><td align="center" style="border-radius:10px;background:linear-gradient(135deg,#0a7c6b,#14b8a6);">
              <a href="${esc(l.button.url)}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(l.button.label)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#94a3b8;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="color:#0a7c6b;word-break:break-all;">${esc(l.button.url)}</span>
          </p>` : ''}
          <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#64748b;">${esc(l.en.footnote)}</p>
        </td></tr>
        <tr><td style="padding:16px 26px 20px;border-top:1px solid #eef2f7;background:#fafcff;">
          <div style="font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Sa Filipino</div>
          ${l.tl.paragraphs.map(p => `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#475569;">${esc(p)}</p>`).join('\n          ')}
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${esc(l.tl.footnote)}</p>
        </td></tr>
        <tr><td style="padding:16px 26px;border-top:1px solid #eef2f7;">
          <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#64748b;">Security: SafeComm never asks for your password by email or text. Never share this link with anyone.</p>
          <p style="margin:0;font-size:13px;color:#475569;">Regards,<br><strong>SafeComm</strong></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Barangay Biñang 2nd Public Safety Office · This is an automatic message.</p>
    </td></tr>
  </table>
</body></html>`;
}

const plain = (l: Layout) => [
  `Hello ${l.name},`, ...l.en.paragraphs, ...(l.button ? [`${l.button.label}: ${l.button.url}`] : []), l.en.footnote,
  '— Sa Filipino —', ...l.tl.paragraphs, l.tl.footnote,
  'Security: SafeComm never asks for your password by email or text. Never share this link with anyone.', 'Regards,\nSafeComm',
].join('\n\n');

/** Never throws: a mail outage must not undo what was saved. Says why it did not send - never the link or the address. */
async function deliver(m: Message): Promise<SendResult> {
  if (sink) { sink(m); return { ok: true, reason: 'sent' }; }
  if (!isEmailConfigured()) {
    console.warn('[email] SMTP is not configured - an email was not sent.');
    return { ok: false, reason: 'not_configured', detail: 'Email is not set up on this server yet.' };
  }
  const s = settings();
  try {
    // "Accepted by the mail server" - not proof of delivery to the inbox, and never said to be.
    const info = await nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 })
      .sendMail({ from: s.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    // Logged: the subject, the recipient's mail provider (the domain only) and the server's answer - never the address or a link.
    const domain = m.to.split('@')[1] ?? '?';
    const reply = String(info.response ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[address]').slice(0, 80);
    if (info.rejected?.length || !info.accepted?.length) {
      console.error(`[email] Refused by the mail server: "${m.subject}" to @${domain} - ${reply}`);
      return { ok: false, reason: 'send_failed', detail: 'The email could not be sent right now.' };
    }
    console.info(`[email] Accepted by ${s.host} (not yet proof of delivery): "${m.subject}" to @${domain} - ${reply}`);
    return { ok: true, reason: 'sent' };
  } catch (err) {
    const e = err as { message?: string; code?: string; responseCode?: number };
    const msg = (e.message ?? String(err)).replace(/https?:\/\/\S+/g, '[link]').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[address]');
    if (/only send testing emails to your own email address|verify a domain/i.test(msg)) {
      console.error('[email] The email provider is in test mode and refused the recipient.');
      return { ok: false, reason: 'sandbox_recipient_blocked', detail: 'The email provider is still in test mode and can only deliver to the account owner’s address.' };
    }
    console.error('[email] Send failed:', [e.code, e.responseCode].filter(Boolean).join(' '), msg.slice(0, 200));
    return { ok: false, reason: 'send_failed', detail: 'The email could not be sent right now.' };
  }
}

export type AuthMailKind = 'confirm' | 'reset' | 'setup';

const EXPIRY_EN = 'This link works once and expires after one hour. If it has expired, ask for a new one on the SafeComm sign-in page.';
const EXPIRY_TL = 'Isang beses lang magagamit ang link at mag-e-expire ito pagkalipas ng isang oras. Kung expired na, humingi ng bago sa sign-in page ng SafeComm.';

const AUTH_MAIL: Record<AuthMailKind, { subject: string; button: string; en: Words; tl: Words }> = {
  confirm: {
    subject: 'Verify Your SafeComm Account',
    button: 'Verify Email',
    en: { paragraphs: ['You are receiving this email because this address was used to create a resident account on SafeComm, the community safety platform of Barangay Biñang 2nd.',
      'Verify your email address with the button below.',
      'Verifying your email does not approve your residency: an authorised barangay official still reviews it before you can file reports.'],
    footnote: `${EXPIRY_EN} If you did not create this account, you can safely ignore this email.` },
    tl: { paragraphs: ['Natanggap mo ito dahil ginamit ang email na ito para gumawa ng resident account sa SafeComm ng Barangay Biñang 2nd. Pindutin ang "Verify Email" para i-verify ang iyong email.',
      'Hindi pa nito inaaprubahan ang iyong paninirahan: susuriin pa ito ng isang awtorisadong opisyal ng barangay.'],
    footnote: `${EXPIRY_TL} Kung hindi ikaw ang gumawa ng account, huwag pansinin ang email na ito.` },
  },
  reset: {
    subject: 'Reset Your SafeComm Password',
    button: 'Reset Password',
    en: { paragraphs: ['You are receiving this email because someone asked to reset the password of the SafeComm account for this address.',
      'Choose a new password with the button below.'],
    footnote: `${EXPIRY_EN} If you did not ask for this, ignore this email - your password stays as it is.` },
    tl: { paragraphs: ['Natanggap mo ito dahil may humiling na i-reset ang password ng SafeComm account ng email na ito. Pindutin ang "Reset Password" para pumili ng bagong password.'],
      footnote: `${EXPIRY_TL} Kung hindi ikaw ang humiling, huwag pansinin ito - hindi magbabago ang iyong password.` },
  },
  setup: {
    subject: 'Set Up Your SafeComm Password',
    button: 'Set My Password',
    en: { paragraphs: ['You are receiving this email because you asked to set up the new SafeComm sign-in for your resident account.',
      'Your resident profile and your reports are kept. Choose a password with the button below to sign in again.'],
    footnote: `${EXPIRY_EN} If you did not ask for this, you can safely ignore this email.` },
    tl: { paragraphs: ['May bagong sign-in ang SafeComm. Nananatili ang iyong profile at mga report. Pindutin ang "Set My Password" para pumili ng password.'],
      footnote: `${EXPIRY_TL} Kung hindi ikaw ang humiling, huwag pansinin ito.` },
  },
};

/** A Supabase Auth link (on SafeComm's own site), in SafeComm's words. */
export function sendAuthEmail(kind: AuthMailKind, to: string, name: string, url: string): Promise<SendResult> {
  const t = AUTH_MAIL[kind];
  const l: Layout = { name, en: t.en, tl: t.tl, button: { label: t.button, url } };
  return deliver({ to, subject: t.subject, html: template(l), text: plain(l) });
}

/** After a password was set or changed: a notice with no link that signs anyone in. */
export function sendPasswordChangedEmail(to: string, name: string, signInUrl: string): Promise<SendResult> {
  const l: Layout = {
    name, button: { label: 'Sign In to SafeComm', url: signInUrl },
    en: { paragraphs: ['The password of your SafeComm resident account was just changed. You can now sign in with your new password.'],
      footnote: 'If you did not change it, contact the Barangay Biñang 2nd office right away, and use "Forgot password" on the sign-in page to choose a new one.' },
    tl: { paragraphs: ['Napalitan na ang password ng iyong SafeComm resident account. Maaari ka nang mag-sign in gamit ang bagong password.'],
      footnote: 'Kung hindi ikaw ang nagpalit, makipag-ugnayan agad sa tanggapan ng Barangay Biñang 2nd at gamitin ang "Forgot password" para pumili ng bago.' },
  };
  return deliver({ to, subject: 'Your SafeComm Password Has Been Updated', html: template(l), text: plain(l) });
}

/** A notice with no secret in it (the residency decisions), with a link to the portal. */
export function sendNoticeEmail(to: string, name: string, subject: string, paragraphs: string[], link: { label: string; url: string } | null): Promise<SendResult> {
  const l: Layout = { name, button: link, en: { paragraphs, footnote: 'This is an automatic message from SafeComm.' },
    tl: { paragraphs: ['May bagong update sa iyong SafeComm account. Buksan ang SafeComm para makita ito.'], footnote: 'Awtomatikong mensahe ito mula sa SafeComm.' } };
  return deliver({ to, subject, html: template(l), text: plain(l) });
}
