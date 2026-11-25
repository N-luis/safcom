-- SafeComm 030, undone: back to 029. Run only after the code that uses it has been rolled back:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/030_verified_streets.down.sql
-- Removes the verified street lists and which street a case or referral used (the street name itself is kept).

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_street_values_check";

ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_street_values_check";

DROP TABLE IF EXISTS "VerifiedStreet";

ALTER TABLE "Case" DROP COLUMN IF EXISTS "incidentBarangay", DROP COLUMN IF EXISTS "streetId", DROP COLUMN IF EXISTS "streetManual";

ALTER TABLE "JurisdictionReferral" DROP COLUMN IF EXISTS "streetId", DROP COLUMN IF EXISTS "streetManual";
