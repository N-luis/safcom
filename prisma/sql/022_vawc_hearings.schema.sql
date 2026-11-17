-- SafeComm 022: VAWC cases use the same hearing workflow as blotter cases
-- (CaseHearing), and the VAWC Appointments are merged into it. Additive only:
-- one nullable column (the appointment a hearing was made from, unique so the
-- data migration can run twice without copying twice) and one index. Generated
-- with `prisma migrate diff` from the previous schema to this one, reviewed. Run:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/022_vawc_hearings.schema.sql
-- Then the checks: prisma/sql/022_vawc_hearings.sql
-- Undo (both files): prisma/sql/022_vawc_hearings.down.sql

ALTER TABLE "CaseHearing" ADD COLUMN IF NOT EXISTS "migratedFromAppointmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CaseHearing_migratedFromAppointmentId_key" ON "CaseHearing"("migratedFromAppointmentId");

CREATE INDEX IF NOT EXISTS "CaseHearing_caseId_scheduledAt_idx" ON "CaseHearing"("caseId", "scheduledAt");
