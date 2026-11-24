/**
 * Email settings check - prints categories only (never a password, username or address).
 *   npx tsx --env-file=.env scripts/email-check.ts
 * The live site reports the same at /api/health ("emailSettings", "emailLogin").
 */
import { emailSettingsReport, emailLoginStatus } from '../lib/email';

async function main() {
  const login = await emailLoginStatus();
  console.log(JSON.stringify({ emailLogin: login, ...emailSettingsReport() }, null, 2));
}
main();
