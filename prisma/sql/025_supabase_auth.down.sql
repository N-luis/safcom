-- SafeComm 025, undone: the checks and the foreign key only. The new columns
-- are kept (they hold each resident's sign-in link); drop them by hand only
-- after moving residents to another sign-in.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/025_supabase_auth.down.sql

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_supabaseUserId_fkey";

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_contact_values_check";

-- Only after removing any 'registered' / 'sign_in_linked' history rows by hand:
-- ALTER TABLE "ResidencyEvent" DROP CONSTRAINT IF EXISTS "ResidencyEvent_values_check";
-- ALTER TABLE "ResidencyEvent" ADD CONSTRAINT "ResidencyEvent_values_check" CHECK ("kind" IN ('submitted','approved','rejected','info_requested','address_changed','outside_refused','backfilled') AND "actorType" IN ('resident','official','system'));
