-- SafeComm 025 (schema): resident sign-in moves to Supabase Auth. Additive only:
-- no table, column or row is removed. Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/025_supabase_auth.schema.sql
-- Then run 025_supabase_auth.sql.

ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "supabaseUserId" UUID;

ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "altContactNumber" TEXT;

ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Resident_supabaseUserId_key" ON "Resident"("supabaseUserId");
