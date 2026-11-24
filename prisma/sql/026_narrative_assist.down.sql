-- SafeComm 026, undone: the check only. The columns hold residents' own words
-- and are kept; drop them by hand only after copying what they hold.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/026_narrative_assist.down.sql

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_narrative_assist_check";
