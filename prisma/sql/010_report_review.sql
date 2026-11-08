-- SafeComm 010: report review records are closed to the public API roles, and
-- the history they hold cannot be rewritten.
--
-- Safe to run more than once. Run after 010_report_review.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/010_report_review.sql
--
-- A report version (ReportAddendum) and a recorded interview are append-only.
-- A draft's content is fixed once written; only its approval may be recorded
-- (status, who, when, note). A clarification request's question is fixed;
-- only whether it was answered or cancelled may change. Rows still go with
-- their case (the cascade is a DELETE, not an UPDATE).

CREATE OR REPLACE FUNCTION report_row_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% rows cannot be changed', TG_TABLE_NAME; END $$;

DROP TRIGGER IF EXISTS report_addendum_immutable ON "ReportAddendum";
CREATE TRIGGER report_addendum_immutable BEFORE UPDATE ON "ReportAddendum" FOR EACH ROW EXECUTE FUNCTION report_row_immutable();

DROP TRIGGER IF EXISTS case_interview_immutable ON "CaseInterview";
CREATE TRIGGER case_interview_immutable BEFORE UPDATE ON "CaseInterview" FOR EACH ROW EXECUTE FUNCTION report_row_immutable();

CREATE OR REPLACE FUNCTION report_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (to_jsonb(NEW) - 'status' - 'approvedById' - 'approvedAt' - 'approvalNote') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'approvedById' - 'approvedAt' - 'approvalNote') THEN RAISE EXCEPTION 'A report draft cannot be rewritten - write a new draft'; END IF; IF OLD."status" = 'SUPERSEDED' OR (OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'SUPERSEDED')) THEN RAISE EXCEPTION 'A superseded or approved draft cannot go back to a draft'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS report_draft_guard ON "ReportDraft";
CREATE TRIGGER report_draft_guard BEFORE UPDATE ON "ReportDraft" FOR EACH ROW EXECUTE FUNCTION report_draft_guard();

CREATE OR REPLACE FUNCTION clarification_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."caseId" IS DISTINCT FROM OLD."caseId" OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById" OR NEW."items" IS DISTINCT FROM OLD."items" OR NEW."message" IS DISTINCT FROM OLD."message" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'A clarification request cannot be rewritten'; END IF; IF OLD."status" <> 'OPEN' THEN RAISE EXCEPTION 'An answered or cancelled request is closed'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS clarification_request_guard ON "ClarificationRequest";
CREATE TRIGGER clarification_request_guard BEFORE UPDATE ON "ClarificationRequest" FOR EACH ROW EXECUTE FUNCTION clarification_request_guard();

ALTER TABLE "ReportAddendum" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClarificationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CaseInterview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportDraft" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "ReportAddendum" FROM anon, authenticated;
REVOKE ALL ON "ClarificationRequest" FROM anon, authenticated;
REVOKE ALL ON "CaseInterview" FROM anon, authenticated;
REVOKE ALL ON "ReportDraft" FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION report_row_immutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION report_draft_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION clarification_request_guard() FROM PUBLIC, anon, authenticated;

ALTER TABLE "ReportAddendum" DROP CONSTRAINT IF EXISTS "ReportAddendum_source_check";
ALTER TABLE "ReportAddendum" ADD CONSTRAINT "ReportAddendum_source_check" CHECK ("source" IN ('RESIDENT_CORRECTION', 'RESIDENT_ADDITION', 'RESIDENT_CLARIFICATION', 'RESIDENT_ANSWERS', 'INTERVIEW'));
ALTER TABLE "ReportAddendum" DROP CONSTRAINT IF EXISTS "ReportAddendum_version_check";
ALTER TABLE "ReportAddendum" ADD CONSTRAINT "ReportAddendum_version_check" CHECK ("version" >= 2 AND "previousVersion" = "version" - 1);
ALTER TABLE "ReportAddendum" DROP CONSTRAINT IF EXISTS "ReportAddendum_author_check";
ALTER TABLE "ReportAddendum" ADD CONSTRAINT "ReportAddendum_author_check" CHECK ("residentId" IS NOT NULL OR "actorUserId" IS NOT NULL);
ALTER TABLE "ReportDraft" DROP CONSTRAINT IF EXISTS "ReportDraft_status_check";
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'SUPERSEDED') AND ("status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)));
ALTER TABLE "ReportDraft" DROP CONSTRAINT IF EXISTS "ReportDraft_template_check";
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_template_check" CHECK ("template" IN ('BLOTTER', 'VAWC'));
ALTER TABLE "ClarificationRequest" DROP CONSTRAINT IF EXISTS "ClarificationRequest_status_check";
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_status_check" CHECK ("status" IN ('OPEN', 'ANSWERED', 'CANCELLED'));
