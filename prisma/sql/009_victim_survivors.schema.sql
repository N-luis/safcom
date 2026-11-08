-- SafeComm 009: the victim-survivors of a VAWC case, one row per person, for
-- the women-and-children statistics. Additive only - no existing table or row
-- is changed. Reviewed output of:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/009_victim_survivors.schema.sql
-- Then:    npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/009_victim_survivors.sql

-- CreateTable
CREATE TABLE "CaseVictimSurvivor" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sexAtBirth" TEXT,
    "birthDate" TIMESTAMP(3),
    "ageAtIncident" INTEGER,
    "clientCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'official',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedReason" TEXT,

    CONSTRAINT "CaseVictimSurvivor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseVictimSurvivor_caseId_idx" ON "CaseVictimSurvivor"("caseId");

-- CreateIndex
CREATE INDEX "CaseVictimSurvivor_clientCode_idx" ON "CaseVictimSurvivor"("clientCode");

-- AddForeignKey
ALTER TABLE "CaseVictimSurvivor" ADD CONSTRAINT "CaseVictimSurvivor_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
