-- 028: incident referrals - the File a Report form re-routes an incident outside the jurisdiction to a referral,
-- and an uncertain location to verification. Additive only: new columns on JurisdictionReferral, two new tables.
-- Generated with prisma migrate diff (schema at HEAD -> this schema), reviewed. Apply before 028_incident_referrals.sql.

-- AlterTable
ALTER TABLE "JurisdictionReferral" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "caseId" TEXT,
ADD COLUMN     "confidential" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwardedAt" TIMESTAMP(3),
ADD COLUMN     "incidentDate" TIMESTAMP(3),
ADD COLUMN     "incidentTimeApprox" TEXT,
ADD COLUMN     "narrativeAssist" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "receivingOffice" TEXT,
ADD COLUMN     "recommendedDesk" TEXT,
ADD COLUMN     "recommendedDestination" JSONB,
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "reportPayload" JSONB,
ADD COLUMN     "residentOriginalNarrative" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'REFERRAL_FORM',
ADD COLUMN     "submissionKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validationResult" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';

-- CreateTable
CREATE TABLE "JurisdictionReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "residentMessage" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JurisdictionReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionReferralAttachment" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByResidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JurisdictionReferralAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JurisdictionReferralEvent_referralId_createdAt_idx" ON "JurisdictionReferralEvent"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX "JurisdictionReferralAttachment_referralId_idx" ON "JurisdictionReferralAttachment"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionReferralAttachment_referralId_sha256_key" ON "JurisdictionReferralAttachment"("referralId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionReferral_referenceNumber_key" ON "JurisdictionReferral"("referenceNumber");

-- CreateIndex
CREATE INDEX "JurisdictionReferral_confidential_status_idx" ON "JurisdictionReferral"("confidential", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionReferral_residentId_submissionKey_key" ON "JurisdictionReferral"("residentId", "submissionKey");

-- AddForeignKey
ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionReferralEvent" ADD CONSTRAINT "JurisdictionReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "JurisdictionReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionReferralAttachment" ADD CONSTRAINT "JurisdictionReferralAttachment_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "JurisdictionReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

