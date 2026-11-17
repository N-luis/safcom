/**
 * Merges the VAWC Appointments into hearings (lib/appointmentMigration.ts).
 * Safe to run more than once: an appointment already moved is skipped.
 *
 *   npx tsx --env-file=.env scripts/migrate-appointments-to-hearings.ts --dry-run   # the report only
 *   npx tsx --env-file=.env scripts/migrate-appointments-to-hearings.ts             # migrate
 *
 * Needs prisma/sql/022_vawc_hearings*.sql applied first.
 */
import { prisma } from '../lib/prisma';
import { migrateAppointments, formatReport } from '../lib/appointmentMigration';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const report = await migrateAppointments({ dryRun });
  console.log(formatReport(report));
  if (report.read !== report.created + report.skipped.length) process.exitCode = 1;
}

main()
  .catch(err => { console.error('FAILED:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
