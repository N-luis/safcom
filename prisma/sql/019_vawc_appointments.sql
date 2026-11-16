-- SafeComm 019: VAWC Appointments & Follow-ups - closed to the public API
-- roles, values the database itself checks, a history that cannot be
-- rewritten, and the two desks kept apart in the database too:
--   - an appointment can only be on a VAWC case;
--   - a VAWC case can never get a Katarungang Pambarangay hearing (RA 9262
--     sec. 33: the barangay does not mediate or conciliate these cases).
--
-- Safe to run more than once. Run after 019_vawc_appointments.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/019_vawc_appointments.sql
--
-- The VAWC categories below are lib/vawcTypes.ts VAWC_TYPES; the test
-- tests/vawcAppointments.test.ts fails if the two lists ever differ.
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "VawcAppointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VawcAppointmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VawcAppointmentRequest" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "VawcAppointment" FROM anon, authenticated;
REVOKE ALL ON "VawcAppointmentEvent" FROM anon, authenticated;
REVOKE ALL ON "VawcAppointmentRequest" FROM anon, authenticated;

-- ── The values the app offers, and nothing else ──
-- No mediation, reconciliation or joint session type, and no respondent among the participants.
ALTER TABLE "VawcAppointment" DROP CONSTRAINT IF EXISTS "VawcAppointment_values_check";
ALTER TABLE "VawcAppointment" ADD CONSTRAINT "VawcAppointment_values_check" CHECK ("type" IN ('VICTIM_INTERVIEW','INTAKE_FOLLOW_UP','SAFETY_FOLLOW_UP','REFERRAL_COORDINATION','CASE_CONFERENCE') AND "status" IN ('SCHEDULED','RESCHEDULED','COMPLETED','NOT_HELD','CANCELLED') AND "notifyVia" IN ('SAFECOMM_ACCOUNT','OFFICER_CONTACT','NONE') AND cardinality("participants") > 0 AND "participants" <@ ARRAY['REPORTER','VICTIM_SURVIVOR','SUPPORT_PERSON','SERVICE_PROVIDER','VAWC_STAFF']::text[] AND ("attendance" IS NULL OR "attendance" IN ('ATTENDED','DID_NOT_ATTEND','NOT_APPLICABLE')) AND ("referralStatus" IS NULL OR "referralStatus" IN ('NOT_NEEDED','TO_BE_MADE','IN_PROGRESS','COMPLETED','DECLINED_BY_CLIENT')) AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)) AND (("status" IN ('COMPLETED','NOT_HELD')) = ("completedAt" IS NOT NULL)));

ALTER TABLE "VawcAppointmentRequest" DROP CONSTRAINT IF EXISTS "VawcAppointmentRequest_values_check";
ALTER TABLE "VawcAppointmentRequest" ADD CONSTRAINT "VawcAppointmentRequest_values_check" CHECK ("status" IN ('PENDING','APPROVED','DECLINED') AND (("status" = 'PENDING') = ("pendingKey" IS NOT NULL)));

-- ── The history cannot be rewritten (it may still go with its case) ──
CREATE OR REPLACE FUNCTION vawc_appointment_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VawcAppointmentEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS vawc_appointment_event_immutable ON "VawcAppointmentEvent";

CREATE TRIGGER vawc_appointment_event_immutable BEFORE UPDATE ON "VawcAppointmentEvent" FOR EACH ROW EXECUTE FUNCTION vawc_appointment_event_immutable();

-- ── An appointment is on a VAWC case, and stays on it ──
CREATE OR REPLACE FUNCTION vawc_appointment_case_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'UPDATE' AND NEW."caseId" IS DISTINCT FROM OLD."caseId" THEN RAISE EXCEPTION 'A VAWC appointment cannot be moved to another case'; END IF; IF NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN RAISE EXCEPTION 'A VAWC appointment must be on a VAWC case'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS vawc_appointment_case_check ON "VawcAppointment";

CREATE TRIGGER vawc_appointment_case_check BEFORE INSERT OR UPDATE ON "VawcAppointment" FOR EACH ROW EXECUTE FUNCTION vawc_appointment_case_check();

-- ── A VAWC case never gets a Katarungang Pambarangay hearing ──
-- The hearing routes already refuse it; this holds even if a route forgot.
CREATE OR REPLACE FUNCTION kp_hearing_not_vawc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN RAISE EXCEPTION 'VAWC cases under RA 9262 are not subject to barangay mediation or conciliation'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS kp_hearing_not_vawc ON "CaseHearing";

CREATE TRIGGER kp_hearing_not_vawc BEFORE INSERT ON "CaseHearing" FOR EACH ROW EXECUTE FUNCTION kp_hearing_not_vawc();
