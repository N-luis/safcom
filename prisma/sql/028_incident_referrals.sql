-- SafeComm 028: incident referrals - the values, RLS and the history guard.
-- Apply after 028_incident_referrals.schema.sql. Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/028_incident_referrals.sql
-- No referral record existed when this was written (2026-11-25), so the old
-- statuses NEW / REVIEWED are replaced outright; any row still carrying one is
-- moved to its equivalent first (NEW -> PENDING_REVIEW, REVIEWED -> READY_FOR_REFERRAL).

-- ── RLS: server-only, like every other SafeComm table. No anon or authenticated access. ──
ALTER TABLE "JurisdictionReferralEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "JurisdictionReferralAttachment" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "JurisdictionReferralEvent" FROM anon, authenticated;

REVOKE ALL ON "JurisdictionReferralAttachment" FROM anon, authenticated;

ALTER TABLE "JurisdictionReferral" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "JurisdictionReferral" FROM anon, authenticated;

-- ── The values ──
ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_values_check";

UPDATE "JurisdictionReferral" SET "status" = 'PENDING_REVIEW' WHERE "status" = 'NEW';

UPDATE "JurisdictionReferral" SET "status" = 'READY_FOR_REFERRAL' WHERE "status" = 'REVIEWED';

-- The kind and status are known values; a pin is both halves or neither; "Referred" and "Acknowledged" carry the
-- date it was forwarded, and "Acknowledged" the date the receiving office's acknowledgment was recorded - never
-- assumed; a record still waiting for its location to be verified cannot be referred onward.
ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_values_check" CHECK ("kind" IN ('OUTSIDE_JURISDICTION','LOCATION_VERIFICATION','UNVERIFIED_REPORTER','URGENT') AND "status" IN ('PENDING_REVIEW','FOR_VERIFICATION','READY_FOR_REFERRAL','REFERRED','ACKNOWLEDGED','FOLLOW_UP_REQUIRED','CLOSED') AND "source" IN ('REFERRAL_FORM','REPORT_FORM') AND ("recommendedDesk" IS NULL OR "recommendedDesk" IN ('VAWC','BLOTTER','STAFF_REVIEW','NEEDS_CLARIFICATION')) AND (("latitude" IS NULL) = ("longitude" IS NULL)) AND ("status" NOT IN ('REFERRED','ACKNOWLEDGED') OR "forwardedAt" IS NOT NULL) AND ("status" <> 'ACKNOWLEDGED' OR "acknowledgedAt" IS NOT NULL) AND ("kind" <> 'LOCATION_VERIFICATION' OR "status" IN ('FOR_VERIFICATION','FOLLOW_UP_REQUIRED','CLOSED')) AND ("caseId" IS NULL OR "status" = 'CLOSED'));

ALTER TABLE "JurisdictionReferralEvent" DROP CONSTRAINT IF EXISTS "JurisdictionReferralEvent_values_check";

ALTER TABLE "JurisdictionReferralEvent" ADD CONSTRAINT "JurisdictionReferralEvent_values_check" CHECK ("kind" IN ('created','status','note','assigned','receiving_office','forwarded','acknowledged','location_rechecked','confirmed_outside','filed_as_case') AND "actorType" IN ('resident','official','system'));

-- ── The history cannot be rewritten: rows are added, never changed. ──
CREATE OR REPLACE FUNCTION jurisdiction_referral_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'JurisdictionReferralEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS jurisdiction_referral_event_immutable ON "JurisdictionReferralEvent";

CREATE TRIGGER jurisdiction_referral_event_immutable BEFORE UPDATE ON "JurisdictionReferralEvent" FOR EACH ROW EXECUTE FUNCTION jurisdiction_referral_event_immutable();
