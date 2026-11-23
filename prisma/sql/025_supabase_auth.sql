-- SafeComm 025: the resident's link to their Supabase Auth user, and the
-- values the database checks. Safe to run more than once. Run after
-- 025_supabase_auth.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/025_supabase_auth.sql
--
-- Sign-in is Supabase Auth's (auth.users); the barangay profile, the residency
-- and every case stay on "Resident". Deleting a Supabase user never deletes a
-- resident or a case: the link is cleared and the profile is kept.
--
-- Access: every public table keeps row level security on with no policy and no
-- grant to anon or authenticated (checked when this was written: 48 tables, 0
-- policies, 0 grants). A resident signed in to Supabase Auth can therefore read
-- or change nothing through the Supabase API directly - not their profile, not
-- their residency status, not a role. SafeComm's server decides every access.

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_supabaseUserId_fkey";

ALTER TABLE "Resident" ADD CONSTRAINT "Resident_supabaseUserId_fkey" FOREIGN KEY ("supabaseUserId") REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_contact_values_check";

ALTER TABLE "Resident" ADD CONSTRAINT "Resident_contact_values_check" CHECK (("altContactNumber" IS NULL OR "altContactNumber" ~ '^09[0-9]{9}$') AND ("postalCode" IS NULL OR "postalCode" ~ '^[0-9]{4}$'));

-- Still closed to the public API roles (as since 002), stated again for this table.
ALTER TABLE "Resident" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "Resident" FROM anon, authenticated;

-- Trigger functions are not meant to be called by anyone directly.
REVOKE EXECUTE ON FUNCTION kp_hearing_not_vawc() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION vawc_appointment_case_check() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION vawc_appointment_event_immutable() FROM PUBLIC, anon, authenticated;

-- The residency history also records a registration (with its address, in one
-- step) and the first sign-in that linked an account from before Supabase Auth.
ALTER TABLE "ResidencyEvent" DROP CONSTRAINT IF EXISTS "ResidencyEvent_values_check";

ALTER TABLE "ResidencyEvent" ADD CONSTRAINT "ResidencyEvent_values_check" CHECK ("kind" IN ('submitted','approved','rejected','info_requested','address_changed','outside_refused','backfilled','registered','sign_in_linked') AND "actorType" IN ('resident','official','system'));
