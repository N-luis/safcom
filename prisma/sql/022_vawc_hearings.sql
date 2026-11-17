-- SafeComm 022: the hearing table takes VAWC hearings, keyed by the case type.
-- Safe to run more than once. Run after 022_vawc_hearings.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/022_vawc_hearings.sql
--
-- What changes:
--   - "stage" also allows the VAWC hearing types (lib/hearings.ts
--     VAWC_HEARING_TYPES); every other value check stays as it was (007);
--   - the trigger that refused any hearing on a VAWC case (019,
--     kp_hearing_not_vawc) is replaced by one that matches the stage to the
--     case: a VAWC case gets a VAWC hearing type and never a Katarungang
--     Pambarangay stage (RA 9262 sec. 33); a blotter case gets a KP stage and
--     never a VAWC type. Checked on insert and whenever the stage or the case
--     changes - not on other updates, so a hearing held before its case moved
--     desks can still be cancelled or recorded.
-- The VAWC categories are lib/vawcTypes.ts VAWC_TYPES, as in 019 to 021.
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so the
-- function body is kept on one line.)

ALTER TABLE "CaseHearing" DROP CONSTRAINT IF EXISTS "CaseHearing_values_check";

ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_values_check" CHECK ("hearingNumber" BETWEEN 1 AND 60 AND "session" BETWEEN 1 AND 30 AND "stage" IN ('MEDIATION','CONSTITUTION','CONCILIATION','VAWC_DESK_HEARING','CASE_CONFERENCE','VICTIM_INTERVIEW','FOLLOW_UP') AND "status" IN ('DRAFT','SCHEDULED','NOTICE_ISSUED','ACKNOWLEDGED','RESCHEDULED','COMPLETED','CANCELLED') AND "complainantAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND "respondentAttendance" IN ('PRESENT','ABSENT','EXCUSED','NOT_RECORDED') AND ("residentIntent" IS NULL OR "residentIntent" IN ('WILL_ATTEND','CANNOT_ATTEND')) AND ("outcome" IS NULL OR "status" = 'COMPLETED'));

DROP TRIGGER IF EXISTS kp_hearing_not_vawc ON "CaseHearing";

CREATE OR REPLACE FUNCTION hearing_stage_matches_case() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE vawc boolean; BEGIN SELECT c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other') INTO vawc FROM "Case" c WHERE c."id" = NEW."caseId"; IF vawc AND NEW."stage" IN ('MEDIATION','CONSTITUTION','CONCILIATION') THEN RAISE EXCEPTION 'VAWC cases under RA 9262 are not subject to barangay mediation or conciliation'; END IF; IF NOT COALESCE(vawc, false) AND NEW."stage" IN ('VAWC_DESK_HEARING','CASE_CONFERENCE','VICTIM_INTERVIEW','FOLLOW_UP') THEN RAISE EXCEPTION 'VAWC hearing types are for VAWC cases only'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS hearing_stage_matches_case ON "CaseHearing";

CREATE TRIGGER hearing_stage_matches_case BEFORE INSERT OR UPDATE OF "stage", "caseId" ON "CaseHearing" FOR EACH ROW EXECUTE FUNCTION hearing_stage_matches_case();

REVOKE EXECUTE ON FUNCTION hearing_stage_matches_case() FROM PUBLIC, anon, authenticated;
