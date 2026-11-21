-- SafeComm 023, undone: back to 022. Run only after the code that uses it has
-- been rolled back:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/023_residency.down.sql
-- This removes the residency history, the jurisdiction configuration, the
-- referrals and the new resident columns (address parts, home location,
-- residency status) - export them first if they must be kept. Cases,
-- residents and their accounts are not touched.

DROP TRIGGER IF EXISTS residency_event_immutable ON "ResidencyEvent";

DROP FUNCTION IF EXISTS residency_event_immutable();

DROP TABLE IF EXISTS "ResidencyEvent";

DROP TABLE IF EXISTS "JurisdictionReferral";

DROP TABLE IF EXISTS "JurisdictionConfig";

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_residency_check";

DROP INDEX IF EXISTS "Resident_residencyStatus_idx";

ALTER TABLE "Resident" DROP COLUMN IF EXISTS "addressCheck", DROP COLUMN IF EXISTS "addressVerificationStatus", DROP COLUMN IF EXISTS "birthDate", DROP COLUMN IF EXISTS "homeLatitude", DROP COLUMN IF EXISTS "homeLocationSource", DROP COLUMN IF EXISTS "homeLongitude", DROP COLUMN IF EXISTS "houseNumber", DROP COLUMN IF EXISTS "municipality", DROP COLUMN IF EXISTS "province", DROP COLUMN IF EXISTS "purok", DROP COLUMN IF EXISTS "residencyNote", DROP COLUMN IF EXISTS "residencyStatus", DROP COLUMN IF EXISTS "residencySubmittedAt", DROP COLUMN IF EXISTS "residencyVerifiedAt", DROP COLUMN IF EXISTS "residencyVerifiedById", DROP COLUMN IF EXISTS "street";
