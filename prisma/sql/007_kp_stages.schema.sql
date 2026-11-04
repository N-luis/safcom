-- SafeComm: Katarungang Pambarangay stages (2026-11-04) - the DDL that brings the
-- database in line with prisma/schema.prisma, generated with
-- `prisma migrate diff --from-config-datasource` and reviewed: it only adds
-- (columns, tables, indexes, foreign keys) and drops nothing. Run once:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/007_kp_stages.schema.sql
-- Then 007_kp_stages.sql: RLS on the new tables and the updated CHECKs.

-- AlterTable
ALTER TABLE "CaseHearing" ADD COLUMN     "session" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'MEDIATION';

-- AlterTable
ALTER TABLE "CaseHearingNotice" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "formNo" INTEGER,
ADD COLUMN     "pangkatMemberId" TEXT,
ADD COLUMN     "recipientResidentId" TEXT,
ADD COLUMN     "seenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CaseHearingRequest" ADD COLUMN     "requesterRole" TEXT NOT NULL DEFAULT 'COMPLAINANT';

-- AlterTable
ALTER TABLE "CaseParty" ADD COLUMN     "residentId" TEXT,
ADD COLUMN     "residentLinkedAt" TIMESTAMP(3),
ADD COLUMN     "residentLinkedById" TEXT;

-- CreateTable
CREATE TABLE "CasePangkat" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "constitutionHearingId" TEXT,
    "constitutedAt" TIMESTAMP(3),
    "chairmanMemberId" TEXT,
    "secretaryMemberId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasePangkat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasePangkatMember" (
    "id" TEXT NOT NULL,
    "pangkatId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chosenBy" TEXT NOT NULL,
    "userId" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedReason" TEXT,

    CONSTRAINT "CasePangkatMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasePangkat_caseId_key" ON "CasePangkat"("caseId");

-- CreateIndex
CREATE INDEX "CasePangkatMember_pangkatId_idx" ON "CasePangkatMember"("pangkatId");

-- CreateIndex
CREATE INDEX "CaseHearingNotice_recipientResidentId_idx" ON "CaseHearingNotice"("recipientResidentId");

-- CreateIndex
CREATE INDEX "CaseParty_residentId_idx" ON "CaseParty"("residentId");

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearingNotice" ADD CONSTRAINT "CaseHearingNotice_recipientResidentId_fkey" FOREIGN KEY ("recipientResidentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePangkat" ADD CONSTRAINT "CasePangkat_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePangkatMember" ADD CONSTRAINT "CasePangkatMember_pangkatId_fkey" FOREIGN KEY ("pangkatId") REFERENCES "CasePangkat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

