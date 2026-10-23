-- SafeComm: reporter contact access - the audit log is append-only, and the
-- public Supabase roles get no access to any table.
--
-- Safe to run more than once. Nothing here deletes or changes a record.
-- Run after `prisma db push` has created "ReporterAccessLog":
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/002_reporter_access.sql
--
-- WHY THE REVOKES. Supabase publishes every table in "public" through its
-- REST API, reachable with the project's anon key, and by default grants the
-- anon and authenticated roles full access to new tables. SafeComm never uses
-- that API: the server reads the database through Prisma as the table owner.
-- So the public roles are given nothing, and RLS is on everywhere with no
-- policy - a second lock, should a grant ever come back. The table owner is
-- not subject to RLS, so the application is unaffected.

-- The audit log: insert and read only. A retention job may delete old rows
-- only by setting safecomm.audit_purge for its own transaction, which needs
-- database credentials - nothing in the application's request path does it.
CREATE OR REPLACE FUNCTION reporter_access_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' AND current_setting('safecomm.audit_purge', true) = 'on' THEN RETURN OLD; END IF; RAISE EXCEPTION 'ReporterAccessLog is append-only (% refused)', TG_OP; END $$;

DROP TRIGGER IF EXISTS reporter_access_log_append_only ON "ReporterAccessLog";

CREATE TRIGGER reporter_access_log_append_only BEFORE UPDATE OR DELETE ON "ReporterAccessLog" FOR EACH ROW EXECUTE FUNCTION reporter_access_log_append_only();

DROP TRIGGER IF EXISTS reporter_access_log_no_truncate ON "ReporterAccessLog";

CREATE TRIGGER reporter_access_log_no_truncate BEFORE TRUNCATE ON "ReporterAccessLog" FOR EACH STATEMENT EXECUTE FUNCTION reporter_access_log_append_only();

-- RLS on every SafeComm table, including the three that were open.
ALTER TABLE "ReporterAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssessmentHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Resident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

-- No access for the public API roles, now or for tables created later.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION reporter_access_log_append_only() FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
