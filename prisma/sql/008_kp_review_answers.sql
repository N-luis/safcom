-- KP eligibility review outcomes (lib/hearings.ts decideKpReview). Run after
-- 008_kp_review_answers.schema.sql. The table stays insert-only (trigger from
-- 006), with RLS on and no anon/authenticated access.
--
--   version 1 (earlier tick boxes): ELIGIBLE | NOT_ELIGIBLE, as before.
--   version 2 (answers):            PENDING_REVIEW | NEEDS_VERIFICATION | ELIGIBLE | NOT_ELIGIBLE,
--                                   and ELIGIBLE only with the approving official recorded.

ALTER TABLE "CaseKpReview" DROP CONSTRAINT IF EXISTS "CaseKpReview_values_check";

ALTER TABLE "CaseKpReview" ADD CONSTRAINT "CaseKpReview_values_check" CHECK (
  ("version" = 1 AND "decision" IN ('ELIGIBLE','NOT_ELIGIBLE'))
  OR ("version" = 2 AND "decision" IN ('PENDING_REVIEW','NEEDS_VERIFICATION','ELIGIBLE','NOT_ELIGIBLE')
      AND ("decision" <> 'ELIGIBLE' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)))
);

ALTER TABLE "CaseKpReview" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CaseKpReview" FROM anon, authenticated;
