/**
 * Standalone SMTP diagnostic — deliberately independent of the app.
 *
 *   node scripts/test-smtp.mjs you@example.com
 *
 * Separates the two failure modes:
 *   verify() fails            -> credentials / host / port / network problem
 *   verify() ok, send fails   -> the account can reach Resend but the message
 *                                was rejected (usually the onboarding@resend.dev
 *                                "own address only" restriction)
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const {
  EMAIL_SERVER: host,
  EMAIL_PORT: port,
  EMAIL_USERNAME: user,
  EMAIL_PASSWORD: pass,
  EMAIL_FROM: from,
} = process.env;

const to = process.argv[2];

if (!to) {
  console.error('Usage: node scripts/test-smtp.mjs <recipient-email>');
  process.exit(1);
}

const mask = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)} (len ${s.length})` : '(empty)');

console.log('--- config ---');
console.log('  host :', host || '(empty)');
console.log('  port :', port || '(empty)');
console.log('  user :', user || '(empty)');
console.log('  pass :', mask(pass));
console.log('  from :', from || '(empty)');
console.log('  to   :', to);
console.log();

if (!host || !user || !pass) {
  console.error('FAIL: SMTP env vars are incomplete — nothing to test.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port: Number(port),
  secure: Number(port) === 465, // 465 = implicit TLS; 587 = STARTTLS
  auth: { user, pass },
});

console.log('--- step 1: verify() — connection + authentication ---');
try {
  await transporter.verify();
  console.log('  PASS: connected and authenticated.\n');
} catch (err) {
  console.error('  FAIL:', err.message);
  console.error('  code:', err.code, '| response:', err.response ?? '(none)');
  console.error('\n  => Credentials, host, port, or network are wrong.');
  console.error('     Supabase is NOT involved in this failure.');
  process.exit(1);
}

console.log('--- step 2: sendMail() — actual delivery ---');
try {
  const info = await transporter.sendMail({
    from,
    to,
    subject: 'SafeComm SMTP test',
    text: 'If you are reading this, Resend SMTP delivery works.',
    html: '<p>If you are reading this, <strong>Resend SMTP delivery works.</strong></p>',
  });
  console.log('  PASS: accepted by the server.');
  console.log('  messageId:', info.messageId);
  console.log('  accepted :', info.accepted);
  console.log('  rejected :', info.rejected);
  console.log('  response :', info.response);
  console.log('\n  => SMTP works. If the mail never arrives, check spam, then');
  console.log('     confirm the recipient restriction described in the README.');
} catch (err) {
  console.error('  FAIL:', err.message);
  console.error('  code:', err.code, '| response:', err.response ?? '(none)');
  console.error('\n  => Auth succeeded but the message was refused.');
  console.error('     With onboarding@resend.dev this almost always means the');
  console.error('     recipient is not the address that owns the Resend account.');
  process.exit(1);
}
