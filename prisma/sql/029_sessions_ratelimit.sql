-- SafeComm 029: sessions and rate limits - values and RLS. Apply after 029_sessions_ratelimit.schema.sql.
-- Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/029_sessions_ratelimit.sql

-- Server-only, like every other SafeComm table: no anon or authenticated access.
ALTER TABLE "AuthSession" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "RateLimitCounter" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "AuthSession" FROM anon, authenticated;

REVOKE ALL ON "RateLimitCounter" FROM anon, authenticated;

ALTER TABLE "AuthSession" DROP CONSTRAINT IF EXISTS "AuthSession_values_check";

-- A session is for an official or a resident, ends after it starts, and a revoked one says why.
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_values_check" CHECK ("kind" IN ('staff','resident') AND "expiresAt" > "createdAt" AND (("revokedAt" IS NULL) = ("revokedReason" IS NULL)));

ALTER TABLE "RateLimitCounter" DROP CONSTRAINT IF EXISTS "RateLimitCounter_values_check";

ALTER TABLE "RateLimitCounter" ADD CONSTRAINT "RateLimitCounter_values_check" CHECK ("count" >= 0 AND "key" ~ '^[0-9a-f]{64}$');
