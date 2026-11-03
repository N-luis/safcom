-- SafeComm: hearings and acknowledgement letters are closed to the public API
-- roles, like every other case table. The app reads them on the server only.
--
-- Safe to run more than once. Run after `prisma db push` has created
-- "CaseHearing" and "AcknowledgementLetter":
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/005_hearings_letters.sql

ALTER TABLE "CaseHearing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcknowledgementLetter" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CaseHearing" FROM anon, authenticated;
REVOKE ALL ON "AcknowledgementLetter" FROM anon, authenticated;
