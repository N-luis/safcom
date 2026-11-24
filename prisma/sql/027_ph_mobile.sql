-- SafeComm 027: a resident's alternative number is stored the standard
-- Philippine way, "+639XXXXXXXXX" (lib/phoneNumber.ts normalizePhMobile), as
-- registration now stores both numbers. Replaces the 025 check, which expected
-- "09XXXXXXXXX". Existing contact numbers are not rewritten. Safe to run more
-- than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/027_ph_mobile.sql

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_contact_values_check";

ALTER TABLE "Resident" ADD CONSTRAINT "Resident_contact_values_check" CHECK (("altContactNumber" IS NULL OR "altContactNumber" ~ '^[+]639[0-9]{9}$') AND ("postalCode" IS NULL OR "postalCode" ~ '^[0-9]{4}$'));
