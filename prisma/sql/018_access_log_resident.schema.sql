-- SafeComm: the access log records which resident's record an official opened.
--
-- Viewing a reporter's resident information no longer asks for a typed reason;
-- every view is still logged, now with the resident it was about, so the log
-- answers "who looked at this resident" across cases as well as per case.
-- Additive only: one nullable column and an index. Older rows keep their
-- reasons and get no resident id. The append-only trigger (002) is unchanged.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/018_access_log_resident.schema.sql

ALTER TABLE "ReporterAccessLog" ADD COLUMN IF NOT EXISTS "residentId" TEXT;

CREATE INDEX IF NOT EXISTS "ReporterAccessLog_residentId_createdAt_idx" ON "ReporterAccessLog"("residentId", "createdAt");
