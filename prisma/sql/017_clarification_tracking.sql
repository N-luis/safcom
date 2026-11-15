-- SafeComm 017 (after 017_clarification_tracking.schema.sql): the request's statuses,
-- kept apart from the case status, and only the ones the workflow uses.
-- Safe to run more than once. (scripts/run-sql.ts splits on ";" at a line end, so the
-- function below is one line, as in 010.)
ALTER TABLE "ClarificationRequest" DROP CONSTRAINT IF EXISTS "ClarificationRequest_status_check";
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_status_check"
  CHECK ("status" IN ('OPEN', 'ANSWERED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'));
ALTER TABLE "ClarificationRequest" DROP CONSTRAINT IF EXISTS "ClarificationRequest_completion_note_len";
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_completion_note_len"
  CHECK ("completionNote" IS NULL OR length("completionNote") <= 500);

-- Row-level security stays on, with nothing granted to the public API roles:
-- residents and officials reach requests only through SafeComm's own routes.
ALTER TABLE "ClarificationRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ClarificationRequest" FROM anon, authenticated;

-- The guard from 010 closed a request once answered. Its progress now continues after
-- the answer - review, then completion - so the guard is replaced, keeping what it
-- protected: the question, who asked and when are fixed; the resident's response
-- (when, and which report version) cannot be rewritten; the start of the review is
-- recorded once; and the status only moves forward:
--   OPEN -> ANSWERED | CANCELLED;  ANSWERED -> IN_REVIEW | COMPLETED;  IN_REVIEW -> COMPLETED.
-- A completed or withdrawn request is closed.
CREATE OR REPLACE FUNCTION clarification_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."caseId" IS DISTINCT FROM OLD."caseId" OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById" OR NEW."items" IS DISTINCT FROM OLD."items" OR NEW."message" IS DISTINCT FROM OLD."message" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'A clarification request cannot be rewritten'; END IF; IF OLD."status" = 'OPEN' THEN IF NEW."status" NOT IN ('OPEN', 'ANSWERED', 'CANCELLED') THEN RAISE EXCEPTION 'An open request is answered or withdrawn first'; END IF; RETURN NEW; END IF; IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'A completed or withdrawn request is closed'; END IF; IF NEW."answeredAt" IS DISTINCT FROM OLD."answeredAt" OR NEW."addendumId" IS DISTINCT FROM OLD."addendumId" OR NEW."cancelledById" IS DISTINCT FROM OLD."cancelledById" OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" OR NEW."cancelReason" IS DISTINCT FROM OLD."cancelReason" THEN RAISE EXCEPTION 'The resident''s response cannot be rewritten'; END IF; IF OLD."reviewStartedAt" IS NOT NULL AND (NEW."reviewStartedAt" IS DISTINCT FROM OLD."reviewStartedAt" OR NEW."reviewStartedById" IS DISTINCT FROM OLD."reviewStartedById") THEN RAISE EXCEPTION 'The start of the review is recorded once'; END IF; IF NOT ((OLD."status" = 'ANSWERED' AND NEW."status" IN ('IN_REVIEW', 'COMPLETED')) OR (OLD."status" = 'IN_REVIEW' AND NEW."status" = 'COMPLETED')) THEN RAISE EXCEPTION 'A request moves forward only: answered, under review, completed'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS clarification_request_guard ON "ClarificationRequest";
CREATE TRIGGER clarification_request_guard BEFORE UPDATE ON "ClarificationRequest" FOR EACH ROW EXECUTE FUNCTION clarification_request_guard();
REVOKE EXECUTE ON FUNCTION clarification_request_guard() FROM PUBLIC, anon, authenticated;
