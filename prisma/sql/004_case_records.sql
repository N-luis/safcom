-- SafeComm: the people, safety assessment and referrals recorded on a case are
-- closed to the public API roles, and an assessment kept in the history can
-- never be rewritten.
--
-- Safe to run more than once. Run after `prisma db push` has created
-- "CaseParty", "CaseSafetyAssessment" and "CaseReferral":
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/004_case_records.sql
--
-- AssessmentHistory: earlier AI assessments, officer confirmations and
-- overrides are kept, not overwritten. A row may still go with its case (the
-- cascade), and its actor may become NULL when that account is deleted (the
-- foreign key's SET NULL); nothing else about it may change.

CREATE OR REPLACE FUNCTION assessment_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (to_jsonb(NEW) - 'actorId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorId') OR (NEW."actorId" IS NOT NULL AND NEW."actorId" IS DISTINCT FROM OLD."actorId") THEN RAISE EXCEPTION 'AssessmentHistory rows cannot be changed'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS assessment_history_immutable ON "AssessmentHistory";

CREATE TRIGGER assessment_history_immutable BEFORE UPDATE ON "AssessmentHistory" FOR EACH ROW EXECUTE FUNCTION assessment_history_immutable();

ALTER TABLE "CaseParty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseSafetyAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseReferral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssessmentHistory" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CaseParty" FROM anon, authenticated;
REVOKE ALL ON "CaseSafetyAssessment" FROM anon, authenticated;
REVOKE ALL ON "CaseReferral" FROM anon, authenticated;
REVOKE ALL ON "AssessmentHistory" FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION assessment_history_immutable() FROM PUBLIC, anon, authenticated;
