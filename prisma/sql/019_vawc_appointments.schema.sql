-- SafeComm 019: VAWC Appointments & Follow-ups - new tables only, nothing
-- existing changes. Reviewed output of:
--   npx prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/019_vawc_appointments.schema.sql
-- Then:    npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/019_vawc_appointments.sql
-- (or both: npm run db:vawc-appointments)

-- CreateTable
CREATE TABLE "VawcAppointment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "assignedOfficerId" TEXT,
    "participants" TEXT[],
    "purpose" TEXT NOT NULL,
    "internalNotes" TEXT,
    "notifyVia" TEXT NOT NULL,
    "residentInstructions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "statusReason" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "attendance" TEXT,
    "outcomeNotes" TEXT,
    "followUpActions" TEXT,
    "referralStatus" TEXT,
    "nextAppointmentAt" TIMESTAMP(3),
    "residentSeenAt" TIMESTAMP(3),
    "residentAcknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VawcAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VawcAppointmentEvent" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VawcAppointmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VawcAppointmentRequest" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
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

    CONSTRAINT "VawcAppointmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VawcAppointment_reference_key" ON "VawcAppointment"("reference");

-- CreateIndex
CREATE INDEX "VawcAppointment_caseId_idx" ON "VawcAppointment"("caseId");

-- CreateIndex
CREATE INDEX "VawcAppointment_status_scheduledAt_idx" ON "VawcAppointment"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "VawcAppointment_assignedOfficerId_idx" ON "VawcAppointment"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "VawcAppointmentEvent_appointmentId_createdAt_idx" ON "VawcAppointmentEvent"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "VawcAppointmentEvent_caseId_createdAt_idx" ON "VawcAppointmentEvent"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VawcAppointmentRequest_pendingKey_key" ON "VawcAppointmentRequest"("pendingKey");

-- CreateIndex
CREATE INDEX "VawcAppointmentRequest_appointmentId_idx" ON "VawcAppointmentRequest"("appointmentId");

-- CreateIndex
CREATE INDEX "VawcAppointmentRequest_status_createdAt_idx" ON "VawcAppointmentRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "VawcAppointment" ADD CONSTRAINT "VawcAppointment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VawcAppointment" ADD CONSTRAINT "VawcAppointment_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VawcAppointmentEvent" ADD CONSTRAINT "VawcAppointmentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "VawcAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VawcAppointmentRequest" ADD CONSTRAINT "VawcAppointmentRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "VawcAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

