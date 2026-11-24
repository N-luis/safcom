-- SafeComm 028, undone: back to 027. Run only after the code that uses it has been rolled back:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/028_incident_referrals.down.sql
-- This removes the referral history, the referral photos and the new referral columns (the full report a
-- referral was saved with, its reference number, receiving office and dates) - export them first if they must
-- be kept. Referral records themselves, cases and residents are kept.

DROP TRIGGER IF EXISTS jurisdiction_referral_event_immutable ON "JurisdictionReferralEvent";

DROP FUNCTION IF EXISTS jurisdiction_referral_event_immutable();

DROP TABLE IF EXISTS "JurisdictionReferralEvent";

DROP TABLE IF EXISTS "JurisdictionReferralAttachment";

ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_values_check";

ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_caseId_fkey";

UPDATE "JurisdictionReferral" SET "kind" = 'OUTSIDE_JURISDICTION' WHERE "kind" = 'LOCATION_VERIFICATION';

UPDATE "JurisdictionReferral" SET "status" = CASE WHEN "status" = 'CLOSED' THEN 'CLOSED' WHEN "status" IN ('PENDING_REVIEW','FOR_VERIFICATION') THEN 'NEW' ELSE 'REVIEWED' END;

DROP INDEX IF EXISTS "JurisdictionReferral_referenceNumber_key";

DROP INDEX IF EXISTS "JurisdictionReferral_confidential_status_idx";

DROP INDEX IF EXISTS "JurisdictionReferral_residentId_submissionKey_key";

ALTER TABLE "JurisdictionReferral" ALTER COLUMN "status" SET DEFAULT 'NEW';

ALTER TABLE "JurisdictionReferral" DROP COLUMN IF EXISTS "acknowledgedAt", DROP COLUMN IF EXISTS "assignedToId", DROP COLUMN IF EXISTS "caseId", DROP COLUMN IF EXISTS "confidential", DROP COLUMN IF EXISTS "forwardedAt", DROP COLUMN IF EXISTS "incidentDate", DROP COLUMN IF EXISTS "incidentTimeApprox", DROP COLUMN IF EXISTS "narrativeAssist", DROP COLUMN IF EXISTS "reason", DROP COLUMN IF EXISTS "receivingOffice", DROP COLUMN IF EXISTS "recommendedDesk", DROP COLUMN IF EXISTS "recommendedDestination", DROP COLUMN IF EXISTS "referenceNumber", DROP COLUMN IF EXISTS "reportPayload", DROP COLUMN IF EXISTS "residentOriginalNarrative", DROP COLUMN IF EXISTS "source", DROP COLUMN IF EXISTS "submissionKey", DROP COLUMN IF EXISTS "updatedAt", DROP COLUMN IF EXISTS "validationResult";

ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_values_check" CHECK ("kind" IN ('OUTSIDE_JURISDICTION','UNVERIFIED_REPORTER','URGENT') AND "status" IN ('NEW','REVIEWED','CLOSED') AND (("latitude" IS NULL) = ("longitude" IS NULL)));
