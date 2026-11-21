-- SafeComm 023: residency verification - closed to the public API roles,
-- the values the database itself checks, and a history that cannot be
-- rewritten. Safe to run more than once. Run after 023_residency.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/023_residency.sql
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "ResidencyEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JurisdictionConfig" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JurisdictionReferral" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "ResidencyEvent" FROM anon, authenticated;

REVOKE ALL ON "JurisdictionConfig" FROM anon, authenticated;

REVOKE ALL ON "JurisdictionReferral" FROM anon, authenticated;

-- ── The values ──
-- A resident is Verified only with the verifier and the date recorded.
ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_residency_check";

ALTER TABLE "Resident" ADD CONSTRAINT "Resident_residency_check" CHECK ("residencyStatus" IN ('INCOMPLETE','PENDING_VERIFICATION','VERIFIED','REJECTED','NEEDS_INFO') AND ("residencyStatus" <> 'VERIFIED' OR ("residencyVerifiedById" IS NOT NULL AND "residencyVerifiedAt" IS NOT NULL)) AND ("homeLocationSource" IS NULL OR "homeLocationSource" IN ('MAP','SEARCH','DEVICE','NONE')) AND ("addressVerificationStatus" IS NULL OR "addressVerificationStatus" IN ('INSIDE','OUTSIDE','INCOMPLETE','NEEDS_REVIEW')) AND (("homeLatitude" IS NULL) = ("homeLongitude" IS NULL)));

ALTER TABLE "ResidencyEvent" DROP CONSTRAINT IF EXISTS "ResidencyEvent_values_check";

ALTER TABLE "ResidencyEvent" ADD CONSTRAINT "ResidencyEvent_values_check" CHECK ("kind" IN ('submitted','approved','rejected','info_requested','address_changed','outside_refused','backfilled') AND "actorType" IN ('resident','official','system'));

ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_values_check";

ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_values_check" CHECK ("kind" IN ('OUTSIDE_JURISDICTION','UNVERIFIED_REPORTER','URGENT') AND "status" IN ('NEW','REVIEWED','CLOSED') AND (("latitude" IS NULL) = ("longitude" IS NULL)));

ALTER TABLE "JurisdictionConfig" DROP CONSTRAINT IF EXISTS "JurisdictionConfig_one_row";

ALTER TABLE "JurisdictionConfig" ADD CONSTRAINT "JurisdictionConfig_one_row" CHECK ("id" = 'default' AND ("boundary" IS NULL OR jsonb_typeof("boundary") = 'object'));

-- ── The history cannot be rewritten ──
CREATE OR REPLACE FUNCTION residency_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ResidencyEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS residency_event_immutable ON "ResidencyEvent";

CREATE TRIGGER residency_event_immutable BEFORE UPDATE ON "ResidencyEvent" FOR EACH ROW EXECUTE FUNCTION residency_event_immutable();

REVOKE EXECUTE ON FUNCTION residency_event_immutable() FROM PUBLIC, anon, authenticated;

-- ── Existing residents: recorded as needing to complete their residency (once) ──
INSERT INTO "ResidencyEvent" ("id", "residentId", "kind", "actorType", "toStatus", "note") SELECT 'bf_' || r."id", r."id", 'backfilled', 'system', 'INCOMPLETE', 'Registered before residency verification: asked to complete the residential address and location, then verified by an official.' FROM "Resident" r WHERE NOT EXISTS (SELECT 1 FROM "ResidencyEvent" e WHERE e."id" = 'bf_' || r."id");
