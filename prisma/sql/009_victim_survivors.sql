-- SafeComm 009: victim-survivor records are closed to the public API roles,
-- and hold only values the statistics can rely on.
--
-- Safe to run more than once. Run after 009_victim_survivors.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/009_victim_survivors.sql
--
-- Same model as 004: the app reads and writes these rows server-side only,
-- after its own role and case-access checks; the Supabase anon/authenticated
-- roles get nothing, and RLS is on with no policy for them.

ALTER TABLE "CaseVictimSurvivor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CaseVictimSurvivor" FROM anon, authenticated;

ALTER TABLE "CaseVictimSurvivor" DROP CONSTRAINT IF EXISTS "CaseVictimSurvivor_sex_check";
ALTER TABLE "CaseVictimSurvivor" ADD CONSTRAINT "CaseVictimSurvivor_sex_check" CHECK ("sexAtBirth" IS NULL OR "sexAtBirth" IN ('female', 'male', 'intersex'));

ALTER TABLE "CaseVictimSurvivor" DROP CONSTRAINT IF EXISTS "CaseVictimSurvivor_age_check";
ALTER TABLE "CaseVictimSurvivor" ADD CONSTRAINT "CaseVictimSurvivor_age_check" CHECK ("ageAtIncident" IS NULL OR ("ageAtIncident" >= 0 AND "ageAtIncident" <= 120));

ALTER TABLE "CaseVictimSurvivor" DROP CONSTRAINT IF EXISTS "CaseVictimSurvivor_source_check";
ALTER TABLE "CaseVictimSurvivor" ADD CONSTRAINT "CaseVictimSurvivor_source_check" CHECK ("source" IN ('official', 'intake'));

-- A removal always says who and why.
ALTER TABLE "CaseVictimSurvivor" DROP CONSTRAINT IF EXISTS "CaseVictimSurvivor_removed_check";
ALTER TABLE "CaseVictimSurvivor" ADD CONSTRAINT "CaseVictimSurvivor_removed_check" CHECK ("removedAt" IS NULL OR ("removedById" IS NOT NULL AND "removedReason" IS NOT NULL));
