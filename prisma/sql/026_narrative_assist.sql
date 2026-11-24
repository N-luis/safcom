-- SafeComm 026: what the database checks. Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/026_narrative_assist.sql
-- An AI-organized description is used only with the resident's own words kept
-- beside it, and only as ACCEPTED or EDITED (by the resident). "Case" stays
-- closed to the public API roles (RLS on, no grants - as since 002).

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_narrative_assist_check";

ALTER TABLE "Case" ADD CONSTRAINT "Case_narrative_assist_check" CHECK (("narrativeAssist" IS NULL AND "residentOriginalNarrative" IS NULL) OR ("narrativeAssist" IN ('ACCEPTED','EDITED') AND "residentOriginalNarrative" IS NOT NULL AND length(btrim("residentOriginalNarrative")) > 0));

ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "Case" FROM anon, authenticated;
