-- SafeComm 026 (schema): the resident's own words kept beside an AI-organized
-- description (the Reporting Assistant). Additive only. Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/026_narrative_assist.schema.sql
-- Then run 026_narrative_assist.sql.

ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "residentOriginalNarrative" TEXT;

ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "narrativeAssist" TEXT;
