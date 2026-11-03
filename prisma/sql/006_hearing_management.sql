-- SafeComm: Hearing Management - closed to the public API roles, a history
-- that cannot be rewritten, and values the database itself checks.
--
-- Safe to run more than once. Run after 006_hearing_management.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/006_hearing_management.sql
--
-- CaseHearingEvent and CaseKpReview are insert-only: an earlier date, notice,
-- attendance record, outcome or eligibility review is kept, never edited. A
-- row may still go with its case or hearing (the cascade).

CREATE OR REPLACE FUNCTION hearing_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% rows cannot be changed', TG_TABLE_NAME; END $$;

DROP TRIGGER IF EXISTS hearing_event_immutable ON "CaseHearingEvent";

CREATE TRIGGER hearing_event_immutable BEFORE UPDATE ON "CaseHearingEvent" FOR EACH ROW EXECUTE FUNCTION hearing_history_immutable();

DROP TRIGGER IF EXISTS kp_review_immutable ON "CaseKpReview";

CREATE TRIGGER kp_review_immutable BEFORE UPDATE ON "CaseKpReview" FOR EACH ROW EXECUTE FUNCTION hearing_history_immutable();

ALTER TABLE "CaseHearing" DROP CONSTRAINT IF EXISTS "CaseHearing_values_check";

ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_values_check" CHECK ("hearingNumber" BETWEEN 1 AND 3 AND "status" IN ('DRAFT','SCHEDULED','NOTICE_ISSUED','ACKNOWLEDGED','RESCHEDULED','COMPLETED','CANCELLED') AND "complainantAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND "respondentAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND ("residentIntent" IS NULL OR "residentIntent" IN ('WILL_ATTEND','CANNOT_ATTEND')) AND ("outcome" IS NULL OR "status" = 'COMPLETED'));

ALTER TABLE "CaseHearingNotice" DROP CONSTRAINT IF EXISTS "CaseHearingNotice_values_check";

ALTER TABLE "CaseHearingNotice" ADD CONSTRAINT "CaseHearingNotice_values_check" CHECK ("recipientRole" IN ('COMPLAINANT','RESPONDENT') AND "status" IN ('GENERATED','ISSUED','DELIVERED','UNDELIVERED','ACKNOWLEDGED','SUPERSEDED'));

ALTER TABLE "CaseHearingRequest" DROP CONSTRAINT IF EXISTS "CaseHearingRequest_values_check";

ALTER TABLE "CaseHearingRequest" ADD CONSTRAINT "CaseHearingRequest_values_check" CHECK ("status" IN ('PENDING','APPROVED','DECLINED') AND (("status" = 'PENDING') = ("pendingKey" IS NOT NULL)));

ALTER TABLE "CaseKpReview" DROP CONSTRAINT IF EXISTS "CaseKpReview_values_check";

ALTER TABLE "CaseKpReview" ADD CONSTRAINT "CaseKpReview_values_check" CHECK ("decision" IN ('ELIGIBLE','NOT_ELIGIBLE'));

ALTER TABLE "CaseHearingNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseHearingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseHearingRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseKpReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseHearing" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CaseHearingNotice" FROM anon, authenticated;
REVOKE ALL ON "CaseHearingEvent" FROM anon, authenticated;
REVOKE ALL ON "CaseHearingRequest" FROM anon, authenticated;
REVOKE ALL ON "CaseKpReview" FROM anon, authenticated;
REVOKE ALL ON "CaseHearing" FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION hearing_history_immutable() FROM PUBLIC, anon, authenticated;
