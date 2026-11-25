-- SafeComm 029, undone: back to 028. Run only after the code that uses it has been rolled back
-- (every signed-in person is signed out, since sessions are no longer checked):
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/029_sessions_ratelimit.down.sql

DROP TABLE IF EXISTS "AuthSession";

DROP TABLE IF EXISTS "RateLimitCounter";
