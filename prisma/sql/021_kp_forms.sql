-- SafeComm 021: KP Forms - closed to the public API roles, only the six forms,
-- and only on a blotter case (a VAWC case never goes to Katarungang
-- Pambarangay proceedings - RA 9262 sec. 33). Safe to run more than once.
-- Run after 021_kp_forms.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/021_kp_forms.sql
--
-- The VAWC categories are lib/vawcTypes.ts VAWC_TYPES, as in 019 and 020.
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "kp_form_records" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "kp_form_records" FROM anon, authenticated;

-- ── The six forms, and nothing else ──
ALTER TABLE "kp_form_records" DROP CONSTRAINT IF EXISTS "kp_form_records_form_type_check";
ALTER TABLE "kp_form_records" ADD CONSTRAINT "kp_form_records_form_type_check" CHECK ("form_type" IN ('KP7','KP8','KP9','KP16','KP18','KP19') AND jsonb_typeof("data") = 'object');

-- ── On a blotter case, and staying on it ──
CREATE OR REPLACE FUNCTION kp_form_record_case_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'UPDATE' AND (NEW."walk_in_report_id" IS DISTINCT FROM OLD."walk_in_report_id" OR NEW."form_type" IS DISTINCT FROM OLD."form_type") THEN RAISE EXCEPTION 'A KP form record cannot be moved to another report or form'; END IF; IF EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."walk_in_report_id" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN RAISE EXCEPTION 'KP forms are for blotter cases; VAWC cases are not subject to barangay conciliation'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS kp_form_record_case_check ON "kp_form_records";

CREATE TRIGGER kp_form_record_case_check BEFORE INSERT OR UPDATE ON "kp_form_records" FOR EACH ROW EXECUTE FUNCTION kp_form_record_case_check();

REVOKE EXECUTE ON FUNCTION kp_form_record_case_check() FROM PUBLIC, anon, authenticated;
