-- SafeComm 011: the referral form's values the database can check. Safe to run
-- more than once. CaseReferral already has RLS on and no public grants (004).
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/011_referral_form.sql

ALTER TABLE "CaseReferral" DROP CONSTRAINT IF EXISTS "CaseReferral_client_age_check";
ALTER TABLE "CaseReferral" ADD CONSTRAINT "CaseReferral_client_age_check" CHECK ("clientAge" IS NULL OR ("clientAge" >= 0 AND "clientAge" <= 120));

ALTER TABLE "CaseReferral" DROP CONSTRAINT IF EXISTS "CaseReferral_client_sex_check";
ALTER TABLE "CaseReferral" ADD CONSTRAINT "CaseReferral_client_sex_check" CHECK ("clientSex" IS NULL OR "clientSex" IN ('Female', 'Male', 'Intersex'));

ALTER TABLE "CaseReferral" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CaseReferral" FROM anon, authenticated;
