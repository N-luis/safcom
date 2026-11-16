-- SafeComm 015: linking a case party (a respondent, say) to a resident's
-- SafeComm account was removed. Permanently removes those links and the
-- record of who made them. Notices already delivered stay on record.
-- Reviewed output of:
--   npx prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script
-- Safe to run more than once. Run only after the code that no longer uses it is deployed:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/015_remove_party_account_links.sql

-- DropForeignKey
ALTER TABLE "CaseParty" DROP CONSTRAINT IF EXISTS "CaseParty_residentId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "CaseParty_residentId_idx";

-- AlterTable
ALTER TABLE "CaseParty" DROP COLUMN IF EXISTS "residentId",
DROP COLUMN IF EXISTS "residentLinkedAt",
DROP COLUMN IF EXISTS "residentLinkedById";
