-- SafeComm 010: report review - versions after filing, clarification requests,
-- recorded interviews and structured drafts. Additive only. Reviewed output of:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/010_report_review.schema.sql
-- Then:    npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/010_report_review.sql


-- CreateTable
CREATE TABLE "ReportAddendum" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "previousVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "text" TEXT,
    "reason" TEXT,
    "residentId" TEXT,
    "actorUserId" TEXT,
    "requestId" TEXT,
    "interviewId" TEXT,
    "material" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarificationRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answeredAt" TIMESTAMP(3),
    "addendumId" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClarificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseInterview" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "interviewedAt" TIMESTAMP(3) NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "notes" TEXT,
    "followUpActions" TEXT,
    "recordedById" TEXT NOT NULL,
    "addendumId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDraft" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "draftNumber" INTEGER NOT NULL,
    "basedOnVersion" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "summary" TEXT,
    "generator" TEXT NOT NULL,
    "aiStatus" TEXT,
    "model" TEXT,
    "needsConfirmation" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdByResident" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,

    CONSTRAINT "ReportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportAddendum_caseId_idx" ON "ReportAddendum"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportAddendum_caseId_version_key" ON "ReportAddendum"("caseId", "version");

-- CreateIndex
CREATE INDEX "ClarificationRequest_caseId_idx" ON "ClarificationRequest"("caseId");

-- CreateIndex
CREATE INDEX "CaseInterview_caseId_idx" ON "CaseInterview"("caseId");

-- CreateIndex
CREATE INDEX "ReportDraft_caseId_idx" ON "ReportDraft"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDraft_caseId_draftNumber_key" ON "ReportDraft"("caseId", "draftNumber");

-- AddForeignKey
ALTER TABLE "ReportAddendum" ADD CONSTRAINT "ReportAddendum_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseInterview" ADD CONSTRAINT "CaseInterview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

