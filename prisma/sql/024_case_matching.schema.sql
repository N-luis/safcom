-- SafeComm 024: duplicate and related case detection. Additive only: three new
-- tables - the pairs found (CaseMatch), their history (CaseMatchEvent), and the
-- record that a case was checked (CaseMatchScan). No existing table or row is
-- changed. Generated with `prisma migrate diff` from the previous schema to
-- this one, reviewed. Run:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/024_case_matching.schema.sql
-- Then the safeguards: prisma/sql/024_case_matching.sql
-- Undo: prisma/sql/024_case_matching.down.sql

-- CreateTable
CREATE TABLE IF NOT EXISTS "CaseMatch" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "matchedCaseId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "desk" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "matchingEstimate" DOUBLE PRECISION NOT NULL,
    "indicators" JSONB NOT NULL,
    "ruleIndicators" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "matchingInformation" TEXT[],
    "differences" TEXT[],
    "uncertainties" TEXT[],
    "explanation" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "aiModel" TEXT,
    "primaryCaseId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CaseMatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "reason" TEXT,
    "primaryCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CaseMatchScan" (
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "aiStatus" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseMatchScan_pkey" PRIMARY KEY ("caseId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CaseMatch_pairKey_key" ON "CaseMatch"("pairKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseMatch_caseId_idx" ON "CaseMatch"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseMatch_matchedCaseId_idx" ON "CaseMatch"("matchedCaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseMatch_status_idx" ON "CaseMatch"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseMatchEvent_matchId_createdAt_idx" ON "CaseMatchEvent"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "CaseMatch" ADD CONSTRAINT "CaseMatch_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMatch" ADD CONSTRAINT "CaseMatch_matchedCaseId_fkey" FOREIGN KEY ("matchedCaseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMatchEvent" ADD CONSTRAINT "CaseMatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "CaseMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseMatchScan" ADD CONSTRAINT "CaseMatchScan_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

