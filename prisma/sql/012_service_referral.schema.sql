-- SafeComm 012: the IACVAWC Service Referral Form ("Referral Form.pdf") on a
-- VAWC case - new tables only, nothing existing changes.
-- Reviewed output of:
--   npx prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/012_service_referral.schema.sql
-- Then:    npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/012_service_referral.sql

-- CreateTable
CREATE TABLE "ServiceReferral" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "destination" TEXT,
    "services" TEXT[],
    "receivingOrganization" TEXT,
    "form" JSONB NOT NULL,
    "prefilled" JSONB,
    "formVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedVia" TEXT,
    "recipientVerifiedAt" TIMESTAMP(3),
    "documentSha256" TEXT,
    "issuedDocument" BYTEA,
    "ackStatus" TEXT,
    "ackReceivedByName" TEXT,
    "ackPosition" TEXT,
    "ackClientCode" TEXT,
    "ackDateReceived" TEXT,
    "ackRemarks" TEXT,
    "ackBasis" TEXT,
    "ackRecordedById" TEXT,
    "ackRecordedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER,
    "changedKeys" TEXT[],
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceReferralAttachment" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceReferralAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReferral_reference_key" ON "ServiceReferral"("reference");

-- CreateIndex
CREATE INDEX "ServiceReferral_caseId_idx" ON "ServiceReferral"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReferral_caseId_requestKey_key" ON "ServiceReferral"("caseId", "requestKey");

-- CreateIndex
CREATE INDEX "ServiceReferralEvent_referralId_createdAt_idx" ON "ServiceReferralEvent"("referralId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceReferralAttachment_referralId_idx" ON "ServiceReferralAttachment"("referralId");

-- AddForeignKey
ALTER TABLE "ServiceReferral" ADD CONSTRAINT "ServiceReferral_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReferralEvent" ADD CONSTRAINT "ServiceReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "ServiceReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReferralAttachment" ADD CONSTRAINT "ServiceReferralAttachment_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "ServiceReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

