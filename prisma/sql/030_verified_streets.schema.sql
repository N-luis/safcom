-- 030: verified streets per barangay (the File a Report street list), and which street a case or referral used.
-- Additive only. Generated with prisma migrate diff (schema at HEAD -> this schema), reviewed. Apply before 030_verified_streets.sql.

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "incidentBarangay" TEXT,
ADD COLUMN     "streetId" TEXT,
ADD COLUMN     "streetManual" BOOLEAN;

-- AlterTable
ALTER TABLE "JurisdictionReferral" ADD COLUMN     "streetId" TEXT,
ADD COLUMN     "streetManual" BOOLEAN;

-- CreateTable
CREATE TABLE "VerifiedStreet" (
    "id" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "barangay" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedStreet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerifiedStreet_province_municipality_barangay_idx" ON "VerifiedStreet"("province", "municipality", "barangay");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedStreet_province_municipality_barangay_name_key" ON "VerifiedStreet"("province", "municipality", "barangay", "name");

