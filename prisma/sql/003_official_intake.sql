-- SafeComm: the official intake tables are closed to the public API roles,
-- and a saved revision can never be edited.
--
-- Safe to run more than once. Run after `prisma db push` has created
-- "OfficialIntake" and "OfficialIntakeRevision":
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/003_official_intake.sql
--
-- Revisions may still be deleted together with their case (the existing
-- "delete case" action cascades); what cannot happen is a saved version being
-- changed after the fact.

CREATE OR REPLACE FUNCTION official_intake_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OfficialIntakeRevision rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS official_intake_revision_immutable ON "OfficialIntakeRevision";

CREATE TRIGGER official_intake_revision_immutable BEFORE UPDATE ON "OfficialIntakeRevision" FOR EACH ROW EXECUTE FUNCTION official_intake_revision_immutable();

ALTER TABLE "OfficialIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfficialIntakeRevision" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "OfficialIntake" FROM anon, authenticated;
REVOKE ALL ON "OfficialIntakeRevision" FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION official_intake_revision_immutable() FROM PUBLIC, anon, authenticated;
