-- SafeComm 014: ID verification was removed, so the link to a resident's
-- uploaded ID is no longer kept. Permanently removes the column and its values.
-- Run only after the code that no longer uses it is deployed. Safe to run more
-- than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/014_drop_resident_id_document.sql

ALTER TABLE "Resident" DROP COLUMN IF EXISTS "idDocument";
