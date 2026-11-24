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
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();

/**
 * The SMTP settings, forgiving of how they were pasted: "https://smtp.gmail.com:465/" is read as the
 * host smtp.gmail.com (and port 465 when EMAIL_PORT is not set), and a Gmail app password shown as
 * "abcd efgh ijkl mnop" is used without its spaces (an app password has none).
 */
export function settings() {
  let host = clean(process.env.EMAIL_SERVER).replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  let portFromHost: number | null = null;
  const m = /^(.*):(\d{2,5})$/.exec(host);
  if (m) { host = m[1]; portFromHost = Number(m[2]); }
  const portText = clean(process.env.EMAIL_PORT);
  const port = portText ? Number(portText) : portFromHost ?? 587;
  const gmail = /(^|\.)gmail\.com$|googlemail\.com$/i.test(host);
  const pass = clean(process.env.EMAIL_PASSWORD);
  return {
    from: clean(process.env.EMAIL_FROM) || 'SafeComm <no-reply@safcom.gov.ph>',
    host: host.toLowerCase(),
    port: Number.isFinite(port) ? port : 587,
    user: clean(process.env.EMAIL_USERNAME),
    pass: gmail ? pass.replace(/\s+/g, '') : pass,
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

function template(name: string, paragraphs: string[], button: { label: string; url: string } | null, footnote: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(12,30,70,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0c1e46,#071739);padding:24px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">SafeComm</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:2px;margin-top:4px;">Community Safety Platform</div>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Hello <strong>${esc(name)}</strong>,</p>
          ${paragraphs.map(p => `<p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#475569;">${esc(p)}</p>`).join('\n          ')}
          ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 22px;">
            <tr><td align="center" style="border-radius:10px;background:linear-gradient(135deg,#0a7c6b,#14b8a6);">
              <a href="${esc(button.url)}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(button.label)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 18px;font-size:12px;line-height:1.6;color:#94a3b8;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="color:#0a7c6b;word-break:break-all;">${esc(button.url)}</span>
          </p>` : ''}
          <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">${esc(footnote)}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef2f7;">
          <p style="margin:0;font-size:13px;color:#475569;">Regards,<br><strong>SafeComm</strong></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Barangay Biñang 2nd Public Safety Office</p>
    </td></tr>
  </table>
</body></html>`;
}

/** Never throws: a mail outage must not undo what was saved. Says why it did not send. */
async function deliver(m: Message): Promise<SendResult> {
  if (sink) { sink(m); return { ok: true, reason: 'sent' }; }
  if (!isEmailConfigured()) {
    console.warn('[email] SMTP is not configured - a sign-in email was not sent.');
    return { ok: false, reason: 'not_configured', detail: 'Email is not set up on this server yet.' };
  }
  const s = settings();
  try {
    await nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } })
      .sendMail({ from: s.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    return { ok: true, reason: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Resend's test sender delivers only to the account owner until a domain is verified.
    if (/only send testing emails to your own email address|verify a domain/i.test(msg)) {
      console.error('[email] The email provider is in test mode and refused the recipient.');
      return { ok: false, reason: 'sandbox_recipient_blocked', detail: 'The email provider is still in test mode and can only deliver to the account owner’s address.' };
    }
    console.error('[email] Send failed:', msg.replace(/https?:\/\/\S+/g, '[link]'));
    return { ok: false, reason: 'send_failed', detail: 'The email could not be sent right now.' };
  }
}

export type AuthMailKind = 'confirm' | 'reset' | 'setup';

const AUTH_MAIL: Record<AuthMailKind, { subject: string; paragraphs: string[]; button: string; footnote: string }> = {
  confirm: {
    subject: 'Confirm your SafeComm account',
    paragraphs: ['Thank you for registering with SafeComm. Confirm your email address with the button below.',
      'After that, an authorised official of Barangay Biñang 2nd verifies your residency before you can file reports in the portal.'],
    button: 'Confirm my email',
    footnote: 'If you did not register, you can safely ignore this email.',
  },
  reset: {
    subject: 'Reset your SafeComm password',
    paragraphs: ['Someone asked to reset the password of your SafeComm account. Choose a new password with the button below.'],
    button: 'Choose a new password',
    footnote: 'If you did not ask for this, ignore this email - your password stays as it is.',
  },
  setup: {
    subject: 'Set up your SafeComm sign-in',
    paragraphs: ['SafeComm has a new sign-in. Your resident profile and your reports are kept - choose a password with the button below to sign in again.'],
    button: 'Set my password',
    footnote: 'If you did not ask for this, you can safely ignore this email.',
  },
};

/** A Supabase Auth link (on SafeComm's own site), in SafeComm's words. */
export function sendAuthEmail(kind: AuthMailKind, to: string, name: string, url: string): Promise<SendResult> {
  const t = AUTH_MAIL[kind];
  return deliver({
    to, subject: t.subject, html: template(name, t.paragraphs, { label: t.button, url }, `This link expires after one hour. ${t.footnote}`),
    text: `Hello ${name},\n\n${t.paragraphs.join('\n\n')}\n\n${t.button}: ${url}\n\nThis link expires after one hour. ${t.footnote}\n\nRegards,\nSafeComm`,
  });
}

/** A notice with no secret in it (the residency decisions), with a link to the portal. */
export function sendNoticeEmail(to: string, name: string, subject: string, paragraphs: string[], link: { label: string; url: string } | null): Promise<SendResult> {
  return deliver({
    to, subject, html: template(name, paragraphs, link, 'This is an automatic message from SafeComm.'),
    text: `Hello ${name},\n\n${paragraphs.join('\n\n')}${link ? `\n\n${link.label}: ${link.url}` : ''}\n\nRegards,\nSafeComm`,
  });
}
