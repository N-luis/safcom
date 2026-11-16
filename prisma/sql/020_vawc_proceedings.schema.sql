-- SafeComm 020: VAWC Hearings (the desk's scheduling, kept in VawcAppointment)
-- and VAWC Case Proceedings.
--   - VawcAppointment gets three nullable court columns, for the
--     "External court hearing (tracking only)" type, and a nullable unique
--     submissionKey so a double submit of one Create form saves one record.
--     No existing column or row is changed.
--   - New tables: Barangay Protection Orders (application, ex parte decision
--     and service as separate parts), referral tracking, and one insert-only
--     history for both.
-- Additive only. Generated with `prisma migrate diff` from the previous
-- schema (019) to this one, reviewed. Run after 019:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/020_vawc_proceedings.schema.sql
-- Then the safeguards: prisma/sql/020_vawc_proceedings.sql

ALTER TABLE "VawcAppointment" ADD COLUMN     "courtMatter" TEXT,
ADD COLUMN     "courtReference" TEXT,
ADD COLUMN     "courtSource" TEXT,
ADD COLUMN     "submissionKey" TEXT;

CREATE TABLE "VawcBpo" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "applicantType" TEXT NOT NULL,
    "applicationNotes" TEXT,
    "receivedById" TEXT NOT NULL,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "actingRole" TEXT,
    "actingOfficialName" TEXT,
    "punongBarangayUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "exParteAssessment" TEXT,
    "decisionRecordedById" TEXT,
    "servedAt" TIMESTAMP(3),
    "serviceMethod" TEXT,
    "servedByName" TEXT,
    "serviceNotes" TEXT,
    "serviceRecordedById" TEXT,
    "assignedOfficerId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VawcBpo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VawcReferral" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "agencyType" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "referredAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REFERRED',
    "followUpAt" TIMESTAMP(3),
    "outcome" TEXT,
    "serviceReferralId" TEXT,
    "assignedOfficerId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VawcReferral_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VawcProceedingEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "recordKind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "reminderKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VawcProceedingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VawcBpo_reference_key" ON "VawcBpo"("reference");

CREATE INDEX "VawcBpo_caseId_idx" ON "VawcBpo"("caseId");

CREATE INDEX "VawcBpo_status_idx" ON "VawcBpo"("status");

CREATE UNIQUE INDEX "VawcReferral_reference_key" ON "VawcReferral"("reference");

CREATE INDEX "VawcReferral_caseId_idx" ON "VawcReferral"("caseId");

CREATE INDEX "VawcReferral_status_followUpAt_idx" ON "VawcReferral"("status", "followUpAt");

CREATE UNIQUE INDEX "VawcProceedingEvent_reminderKey_key" ON "VawcProceedingEvent"("reminderKey");

CREATE INDEX "VawcProceedingEvent_recordKind_recordId_createdAt_idx" ON "VawcProceedingEvent"("recordKind", "recordId", "createdAt");

CREATE INDEX "VawcProceedingEvent_caseId_createdAt_idx" ON "VawcProceedingEvent"("caseId", "createdAt");

CREATE UNIQUE INDEX "VawcAppointment_submissionKey_key" ON "VawcAppointment"("submissionKey");

ALTER TABLE "VawcBpo" ADD CONSTRAINT "VawcBpo_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VawcReferral" ADD CONSTRAINT "VawcReferral_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

