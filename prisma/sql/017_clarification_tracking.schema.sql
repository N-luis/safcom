-- SafeComm 017: a clarification request's own progress - who started reviewing the
-- resident's response and when, and who marked it complete. Additive only: nullable
-- columns; every existing request keeps its status and dates.
-- Written by hand to match `prisma migrate diff` output for this schema change (the
-- direct database connection the diff needs was unreachable when this was made);
-- re-run the diff once it is back and expect no ClarificationRequest statements.
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/017_clarification_tracking.schema.sql
--          npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/017_clarification_tracking.sql

-- AlterTable
ALTER TABLE "ClarificationRequest" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completionNote" TEXT,
ADD COLUMN     "reviewStartedAt" TIMESTAMP(3),
ADD COLUMN     "reviewStartedById" TEXT;
