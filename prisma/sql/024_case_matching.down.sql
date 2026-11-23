-- SafeComm 024, undone: back to 023. Run only after the code that uses it has
-- been rolled back:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/024_case_matching.down.sql
-- Removes the matches, their review history and the check records - export
-- them first if they must be kept. No case is touched.

DROP TRIGGER IF EXISTS case_match_event_immutable ON "CaseMatchEvent";

DROP FUNCTION IF EXISTS case_match_event_immutable();

DROP TRIGGER IF EXISTS case_match_same_desk ON "CaseMatch";

DROP FUNCTION IF EXISTS case_match_same_desk();

DROP TABLE IF EXISTS "CaseMatchEvent";

DROP TABLE IF EXISTS "CaseMatchScan";

DROP TABLE IF EXISTS "CaseMatch";
