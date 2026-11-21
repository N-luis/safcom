-- SafeComm 023: residency verification and the jurisdiction. Additive only:
-- new nullable columns on "Resident" (the address part by part, the confirmed
-- home location, the residency status and who verified it) and three new
-- tables - the residency history, the jurisdiction configuration and the
-- referrals kept for reports that cannot be standard cases. Generated with
-- `prisma migrate diff` from the previous schema to this one, reviewed. Run:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/023_residency.schema.sql
-- Then the safeguards: prisma/sql/023_residency.sql
-- Undo: prisma/sql/023_residency.down.sql
--
-- Every existing resident starts at residencyStatus 'INCOMPLETE' (the column
-- default): none has a structured address or a confirmed location yet, and
-- none was verified as a resident by a person.
-- AlterTable
ALTER TABLE "Resident" ADD COLUMN IF NOT EXISTS "addressCheck" JSONB,
ADD COLUMN IF NOT EXISTS "addressVerificationStatus" TEXT,
ADD COLUMN IF NOT EXISTS "birthDate" DATE,
ADD COLUMN IF NOT EXISTS "homeLatitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "homeLocationSource" TEXT,
ADD COLUMN IF NOT EXISTS "homeLongitude" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "houseNumber" TEXT,
ADD COLUMN IF NOT EXISTS "municipality" TEXT,
ADD COLUMN IF NOT EXISTS "province" TEXT,
ADD COLUMN IF NOT EXISTS "purok" TEXT,
ADD COLUMN IF NOT EXISTS "residencyNote" TEXT,
ADD COLUMN IF NOT EXISTS "residencyStatus" TEXT NOT NULL DEFAULT 'INCOMPLETE',
ADD COLUMN IF NOT EXISTS "residencySubmittedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "residencyVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "residencyVerifiedById" TEXT,
ADD COLUMN IF NOT EXISTS "street" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ResidencyEvent" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidencyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JurisdictionConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "barangay" TEXT NOT NULL,
    "barangayAliases" TEXT[],
    "municipality" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "boundary" JSONB,
    "boundarySource" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JurisdictionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JurisdictionReferral" (
    "id" TEXT NOT NULL,
    "residentId" TEXT,
    "kind" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "reportingRelationship" TEXT,
    "province" TEXT,
    "municipality" TEXT,
    "barangay" TEXT,
    "street" TEXT,
    "locationDetails" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "summary" TEXT,
    "locationCheck" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JurisdictionReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ResidencyEvent_residentId_createdAt_idx" ON "ResidencyEvent"("residentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JurisdictionReferral_status_createdAt_idx" ON "JurisdictionReferral"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JurisdictionReferral_residentId_idx" ON "JurisdictionReferral"("residentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Resident_residencyStatus_idx" ON "Resident"("residencyStatus");

-- AddForeignKey
ALTER TABLE "ResidencyEvent" ADD CONSTRAINT "ResidencyEvent_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

