-- SafeComm 012: the Service Referral Form tables are closed to the public API
-- roles, hold only the values the app offers, keep their history, and an
-- issued referral's document cannot be rewritten.
--
-- Safe to run more than once. Run after 012_service_referral.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/012_service_referral.sql
--
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "ServiceReferral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceReferralEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceReferralAttachment" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "ServiceReferral" FROM anon, authenticated;
REVOKE ALL ON "ServiceReferralEvent" FROM anon, authenticated;
REVOKE ALL ON "ServiceReferralAttachment" FROM anon, authenticated;

-- ── The values the app offers, and nothing else ──
ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_status_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_status_check" CHECK ("status" IN ('DRAFT', 'ISSUED', 'CANCELLED'));

ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_destination_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_destination_check" CHECK ("destination" IS NULL OR "destination" IN ('BARANGAY', 'SWDO'));

ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_ack_status_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_ack_status_check" CHECK ("ackStatus" IS NULL OR "ackStatus" IN ('AWAITING', 'ACKNOWLEDGED', 'RETURNED'));

ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_ack_basis_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_ack_basis_check" CHECK ("ackBasis" IS NULL OR "ackBasis" IN ('SIGNED_COPY', 'WRITTEN', 'VERBAL'));

ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_issued_via_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_issued_via_check" CHECK ("issuedVia" IS NULL OR "issuedVia" IN ('HAND_DELIVERED', 'EMAIL', 'ESCORTED', 'OTHER'));

-- A draft has no acknowledgement; an issued referral always has a document and a state.
ALTER TABLE "ServiceReferral" DROP CONSTRAINT IF EXISTS "ServiceReferral_lifecycle_check";
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_lifecycle_check" CHECK (("status" = 'DRAFT' AND "ackStatus" IS NULL AND "issuedAt" IS NULL) OR ("status" = 'ISSUED' AND "ackStatus" IS NOT NULL AND "issuedAt" IS NOT NULL AND "documentSha256" IS NOT NULL AND "issuedDocument" IS NOT NULL AND "destination" IS NOT NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL));

ALTER TABLE "ServiceReferralAttachment" DROP CONSTRAINT IF EXISTS "ServiceReferralAttachment_kind_check";
ALTER TABLE "ServiceReferralAttachment" ADD CONSTRAINT "ServiceReferralAttachment_kind_check" CHECK ("kind" IN ('SIGNED_REFERRAL', 'ACKNOWLEDGEMENT'));

ALTER TABLE "ServiceReferralAttachment" DROP CONSTRAINT IF EXISTS "ServiceReferralAttachment_size_check";
ALTER TABLE "ServiceReferralAttachment" ADD CONSTRAINT "ServiceReferralAttachment_size_check" CHECK ("size" > 0 AND "size" <= 3145728 AND octet_length("data") = "size");

-- ── The history cannot be rewritten (it may still go with its case) ──
CREATE OR REPLACE FUNCTION service_referral_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ServiceReferralEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS service_referral_event_immutable ON "ServiceReferralEvent";

CREATE TRIGGER service_referral_event_immutable BEFORE UPDATE ON "ServiceReferralEvent" FOR EACH ROW EXECUTE FUNCTION service_referral_event_immutable();

-- ── Once issued, the document is fixed ──
-- The form, its destination, services and recipient, the number, the case
-- and the issued document and its hash cannot change after a referral leaves DRAFT; a
-- cancelled referral cannot come back; an issued one cannot return to draft.
CREATE OR REPLACE FUNCTION service_referral_issued_fixed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."status" <> 'DRAFT' AND (NEW."form" IS DISTINCT FROM OLD."form" OR NEW."destination" IS DISTINCT FROM OLD."destination" OR NEW."services" IS DISTINCT FROM OLD."services" OR NEW."receivingOrganization" IS DISTINCT FROM OLD."receivingOrganization" OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."caseId" IS DISTINCT FROM OLD."caseId" OR NEW."documentSha256" IS DISTINCT FROM OLD."documentSha256" OR NEW."issuedDocument" IS DISTINCT FROM OLD."issuedDocument" OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt") THEN RAISE EXCEPTION 'An issued service referral cannot be rewritten'; END IF; IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled service referral cannot be reopened'; END IF; IF OLD."status" = 'ISSUED' AND NEW."status" = 'DRAFT' THEN RAISE EXCEPTION 'An issued service referral cannot return to draft'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS service_referral_issued_fixed ON "ServiceReferral";

CREATE TRIGGER service_referral_issued_fixed BEFORE UPDATE ON "ServiceReferral" FOR EACH ROW EXECUTE FUNCTION service_referral_issued_fixed();

REVOKE EXECUTE ON FUNCTION service_referral_event_immutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION service_referral_issued_fixed() FROM PUBLIC, anon, authenticated;
