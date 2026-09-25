import nodemailer from 'nodemailer';
import { TOKEN_TTL_MINUTES } from './verification';

const EMAIL_FROM = process.env.EMAIL_FROM ?? 'SafeComm <no-reply@safcom.gov.ph>';
const EMAIL_SERVER = process.env.EMAIL_SERVER;
const EMAIL_PORT = Number(process.env.EMAIL_PORT ?? 587);
const EMAIL_USERNAME = process.env.EMAIL_USERNAME;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;

export function isEmailConfigured(): boolean {
  return Boolean(EMAIL_SERVER && EMAIL_USERNAME && EMAIL_PASSWORD);
}

function transport() {
  return nodemailer.createTransport({
    host: EMAIL_SERVER,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_USERNAME, pass: EMAIL_PASSWORD },
  });
}

export function verificationUrl(rawToken: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function template(name: string, url: string): string {
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
          <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">Hello <strong>${name}</strong>,</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#475569;">
            Thank you for creating your SafeComm account. Please verify your email address by clicking the button below.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;">
            <tr><td align="center" style="border-radius:10px;background:linear-gradient(135deg,#0a7c6b,#14b8a6);">
              <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Verify Email</a>
            </td></tr>
          </table>
          <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#64748b;">
            This verification link will expire after ${TOKEN_TTL_MINUTES} minutes.
          </p>
          <p style="margin:0 0 18px;font-size:12px;line-height:1.6;color:#94a3b8;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="color:#0a7c6b;word-break:break-all;">${url}</span>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
            If you did not create this account, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef2f7;">
          <p style="margin:0;font-size:13px;color:#475569;">Regards,<br><strong>SafeComm</strong></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Biñan City Public Safety Office</p>
    </td></tr>
  </table>
</body></html>`;
}

export type SendReason = 'sent' | 'not_configured' | 'sandbox_recipient_blocked' | 'send_failed';

export interface SendResult {
  ok: boolean;
  reason: SendReason;
  /** Safe to show a user; never contains credentials. */
  detail?: string;
}

/**
 * Never throws — a mail outage must not roll back a successful registration.
 * Returns a reason so the UI can explain *why* rather than guessing.
 */
export async function sendVerificationEmail(
  to: string, name: string, rawToken: string, origin: string,
): Promise<SendResult> {
  const url = verificationUrl(rawToken, origin);

  if (!isEmailConfigured()) {
    // Dev fallback: without SMTP credentials the flow stays testable.
    console.warn(`[email] SMTP not configured — verification link for ${to}:\n  ${url}`);
    return { ok: false, reason: 'not_configured' };
  }

  try {
    await transport().sendMail({
      from: EMAIL_FROM,
      to,
      subject: 'Verify your SafeComm account',
      html: template(name, url),
      text: `Hello ${name},\n\nThank you for creating your SafeComm account.\n\nVerify your email address: ${url}\n\nThis link expires after ${TOKEN_TTL_MINUTES} minutes.\n\nIf you did not create this account, you can safely ignore this email.\n\nRegards,\nSafeComm`,
    });
    return { ok: true, reason: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Resend's sandbox sender (onboarding@resend.dev) refuses every recipient
    // except the account owner until a domain is verified. Detect it so the UI
    // can say so plainly instead of blaming configuration.
    if (/only send testing emails to your own email address|verify a domain/i.test(msg)) {
      console.error(`[email] Sandbox sender blocked recipient ${to}. Verify a domain to email anyone. Link: ${url}`);
      return {
        ok: false,
        reason: 'sandbox_recipient_blocked',
        detail: 'The email provider is still in test mode and can only deliver to the account owner’s address.',
      };
    }

    console.error('[email] Failed to send verification email:', msg);
    return { ok: false, reason: 'send_failed' };
  }
}
