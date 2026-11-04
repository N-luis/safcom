-- SafeComm: Katarungang Pambarangay stages - the Pangkat tables closed to the
-- public API roles like every case table, and the values the database checks
-- brought in line with the stages (RA 7160 secs. 410-412).
--
-- Safe to run more than once. Run after 007_kp_stages.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/007_kp_stages.sql
--
-- A case may now have more than three proceedings (mediation sessions, the
-- constitution of the Pangkat, conciliation sessions), so the 1-3 limit on
-- the proceeding's order is replaced by its stage.

ALTER TABLE "CaseHearing" DROP CONSTRAINT IF EXISTS "CaseHearing_values_check";

ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_values_check" CHECK ("hearingNumber" BETWEEN 1 AND 60 AND "session" BETWEEN 1 AND 30 AND "stage" IN ('MEDIATION','CONSTITUTION','CONCILIATION') AND "status" IN ('DRAFT','SCHEDULED','NOTICE_ISSUED','ACKNOWLEDGED','RESCHEDULED','COMPLETED','CANCELLED') AND "complainantAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND "respondentAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND ("residentIntent" IS NULL OR "residentIntent" IN ('WILL_ATTEND','CANNOT_ATTEND')) AND ("outcome" IS NULL OR "status" = 'COMPLETED'));

ALTER TABLE "CaseHearingNotice" DROP CONSTRAINT IF EXISTS "CaseHearingNotice_values_check";

ALTER TABLE "CaseHearingNotice" ADD CONSTRAINT "CaseHearingNotice_values_check" CHECK ("recipientRole" IN ('COMPLAINANT','RESPONDENT','PANGKAT_MEMBER') AND "status" IN ('GENERATED','ISSUED','DELIVERED','UNDELIVERED','ACKNOWLEDGED','SUPERSEDED') AND ("formNo" IS NULL OR "formNo" BETWEEN 8 AND 12) AND ("channel" IS NULL OR "channel" IN ('SAFECOMM_ACCOUNT','OFFICER')) AND (("recipientRole" = 'PANGKAT_MEMBER') = ("pangkatMemberId" IS NOT NULL)));

ALTER TABLE "CaseHearingRequest" DROP CONSTRAINT IF EXISTS "CaseHearingRequest_values_check";

ALTER TABLE "CaseHearingRequest" ADD CONSTRAINT "CaseHearingRequest_values_check" CHECK ("status" IN ('PENDING','APPROVED','DECLINED') AND "requesterRole" IN ('COMPLAINANT','RESPONDENT') AND (("status" = 'PENDING') = ("pendingKey" IS NOT NULL)));

ALTER TABLE "CasePangkatMember" DROP CONSTRAINT IF EXISTS "CasePangkatMember_values_check";

ALTER TABLE "CasePangkatMember" ADD CONSTRAINT "CasePangkatMember_values_check" CHECK ("chosenBy" IN ('COMPLAINANT','RESPONDENT','BOTH_PARTIES','DRAWN_BY_LOT','PUNONG_BARANGAY'));

ALTER TABLE "CasePangkat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CasePangkatMember" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CasePangkat" FROM anon, authenticated;
REVOKE ALL ON "CasePangkatMember" FROM anon, authenticated;
