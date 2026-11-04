-- KP eligibility review: answers instead of tick boxes (lib/hearings.ts KP_CHECKLIST).
-- Additive only. Existing reviews keep version 1 and their tick-box checklist.
-- Generated with prisma migrate diff and reviewed.

ALTER TABLE "CaseKpReview" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
