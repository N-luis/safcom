-- SafeComm 013: ID verification was removed, so no resident waits for approval.
-- Accounts left as Pending or Rejected by it become Active. Inactive is a
-- separate status and is not touched. Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/013_remove_id_verification.sql

UPDATE "Resident" SET "status" = 'Active' WHERE "status" IN ('Pending', 'Rejected');
