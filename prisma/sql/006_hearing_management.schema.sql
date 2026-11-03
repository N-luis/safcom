-- SafeComm: Hearing Management schema change (2026-11-03) - the DDL that
-- brings the database in line with prisma/schema.prisma, generated with
-- `prisma migrate diff --from-config-datasource` and reviewed: it only adds
-- (columns, tables, indexes, foreign keys) and drops nothing. Run once:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/006_hearing_management.schema.sql
-- Then 006_hearing_management.sql: RLS, the insert-only triggers and the
-- CHECK constraints.

-- AlterTable
ALTER TABLE "CaseAttachment" ADD COLUMN     "hearingId" TEXT;

-- AlterTable
ALTER TABLE "CaseHearing" ADD COLUMN     "activeKey" TEXT,
ADD COLUMN     "agreements" TEXT,
ADD COLUMN     "assignedOfficialId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "complainantAttendance" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
ADD COLUMN     "complainantPartyId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextHearingAt" TIMESTAMP(3),
ADD COLUMN     "openKey" TEXT,
ADD COLUMN     "outcomeSummary" TEXT,
ADD COLUMN     "reference" TEXT NOT NULL,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "residentInstructions" TEXT,
ADD COLUMN     "residentIntent" TEXT,
ADD COLUMN     "residentIntentAt" TIMESTAMP(3),
ADD COLUMN     "respondentAttendance" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
ADD COLUMN     "respondentPartyId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "CaseHearingNotice" (
    "id" TEXT NOT NULL,
    "hearingId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "noticeNumber" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "issueMethod" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "deliveryRecordedById" TEXT,
    "deliveryRecordedAt" TIMESTAMP(3),
    "deliveryNote" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedVia" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CaseHearingNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseHearingEvent" (
    "id" TEXT NOT NULL,
    "hearingId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseHearingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseHearingRequest" (
    "id" TEXT NOT NULL,
    "hearingId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "preferredSchedule" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingKey" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseHearingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseKpReview" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "note" TEXT,
    "reviewedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseKpReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseHearingNotice_noticeNumber_key" ON "CaseHearingNotice"("noticeNumber");

-- CreateIndex
CREATE INDEX "CaseHearingNotice_hearingId_idx" ON "CaseHearingNotice"("hearingId");

-- CreateIndex
CREATE INDEX "CaseHearingNotice_caseId_idx" ON "CaseHearingNotice"("caseId");

-- CreateIndex
CREATE INDEX "CaseHearingEvent_hearingId_createdAt_idx" ON "CaseHearingEvent"("hearingId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseHearingEvent_caseId_createdAt_idx" ON "CaseHearingEvent"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseHearingRequest_pendingKey_key" ON "CaseHearingRequest"("pendingKey");

-- CreateIndex
CREATE INDEX "CaseHearingRequest_hearingId_idx" ON "CaseHearingRequest"("hearingId");

-- CreateIndex
CREATE INDEX "CaseHearingRequest_status_createdAt_idx" ON "CaseHearingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CaseKpReview_caseId_createdAt_idx" ON "CaseKpReview"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseHearing_reference_key" ON "CaseHearing"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "CaseHearing_activeKey_key" ON "CaseHearing"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaseHearing_openKey_key" ON "CaseHearing"("openKey");

-- CreateIndex
CREATE INDEX "CaseHearing_assignedOfficialId_idx" ON "CaseHearing"("assignedOfficialId");

-- AddForeignKey
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "CaseHearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_assignedOfficialId_fkey" FOREIGN KEY ("assignedOfficialId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_complainantPartyId_fkey" FOREIGN KEY ("complainantPartyId") REFERENCES "CaseParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearing" ADD CONSTRAINT "CaseHearing_respondentPartyId_fkey" FOREIGN KEY ("respondentPartyId") REFERENCES "CaseParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearingNotice" ADD CONSTRAINT "CaseHearingNotice_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "CaseHearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearingEvent" ADD CONSTRAINT "CaseHearingEvent_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "CaseHearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseHearingRequest" ADD CONSTRAINT "CaseHearingRequest_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "CaseHearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseKpReview" ADD CONSTRAINT "CaseKpReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

