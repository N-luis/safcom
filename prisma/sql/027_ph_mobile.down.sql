-- SafeComm 027, undone: the 025 check again (only if no "+63..." alternative numbers are stored).
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/027_ph_mobile.down.sql

ALTER TABLE "Resident" DROP CONSTRAINT IF EXISTS "Resident_contact_values_check";

ALTER TABLE "Resident" ADD CONSTRAINT "Resident_contact_values_check" CHECK (("altContactNumber" IS NULL OR "altContactNumber" ~ '^09[0-9]{9}$') AND ("postalCode" IS NULL OR "postalCode" ~ '^[0-9]{4}$'));
