-- SafeComm 016: evidence photos - who uploaded each one, a fingerprint of the
-- stored bytes, and a key that makes a resident's submission safe to retry.
-- Additive only: nullable columns and indexes; no row is changed or removed.
-- Taken from the reviewed output of
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- keeping only this change's statements (the diff also lists 012-014's pending
-- service-referral and ID-verification changes, which are applied separately).
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/016_evidence.schema.sql
--          npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/016_evidence.sql

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "submissionKey" TEXT;

-- AlterTable
ALTER TABLE "CaseAttachment" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "uploadedByResidentId" TEXT,
ADD COLUMN     "uploadedByUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Case_residentId_submissionKey_key" ON "Case"("residentId", "submissionKey");

-- CreateIndex
CREATE INDEX "CaseAttachment_caseId_sha256_idx" ON "CaseAttachment"("caseId", "sha256");
