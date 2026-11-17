-- SafeComm 022, undone: back to 021. Run only after the code that uses VAWC
-- hearings has been rolled back:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/022_vawc_hearings.down.sql
--
-- Nothing is deleted. Hearings already made on VAWC cases (including those
-- migrated from appointments) stay on record: the old stage check is put back
-- NOT VALID, so it binds new rows only, and the old "no hearing on a VAWC
-- case" trigger binds inserts only. The VawcAppointment rows were never
-- changed by the merge, so the Appointments module works on them as before.
-- Dropping the column removes only the link from a hearing to the appointment
-- it was made from.

DROP TRIGGER IF EXISTS hearing_stage_matches_case ON "CaseHearing";

DROP FUNCTION IF EXISTS hearing_stage_matches_case();

ALTER TABLE "CaseHearing" DROP CONSTRAINT IF EXISTS "CaseHearing_values_check";

ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_values_check" CHECK ("hearingNumber" BETWEEN 1 AND 60 AND "session" BETWEEN 1 AND 30 AND "stage" IN ('MEDIATION','CONSTITUTION','CONCILIATION') AND "status" IN ('DRAFT','SCHEDULED','NOTICE_ISSUED','ACKNOWLEDGED','RESCHEDULED','COMPLETED','CANCELLED') AND "complainantAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND "respondentAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND ("residentIntent" IS NULL OR "residentIntent" IN ('WILL_ATTEND','CANNOT_ATTEND')) AND ("outcome" IS NULL OR "status" = 'COMPLETED')) NOT VALID;

CREATE OR REPLACE FUNCTION kp_hearing_not_vawc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN RAISE EXCEPTION 'VAWC cases under RA 9262 are not subject to barangay mediation or conciliation'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS kp_hearing_not_vawc ON "CaseHearing";

CREATE TRIGGER kp_hearing_not_vawc BEFORE INSERT ON "CaseHearing" FOR EACH ROW EXECUTE FUNCTION kp_hearing_not_vawc();

REVOKE EXECUTE ON FUNCTION kp_hearing_not_vawc() FROM PUBLIC, anon, authenticated;

DROP INDEX IF EXISTS "CaseHearing_caseId_scheduledAt_idx";

DROP INDEX IF EXISTS "CaseHearing_migratedFromAppointmentId_key";

ALTER TABLE "CaseHearing" DROP COLUMN IF EXISTS "migratedFromAppointmentId";
