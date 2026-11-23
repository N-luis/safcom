-- SafeComm 024: duplicate and related case detection - closed to the public
-- API roles, the values the database checks, one desk per pair, and a history
-- that cannot be rewritten. Safe to run more than once. Run after
-- 024_case_matching.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/024_case_matching.sql
-- The VAWC categories are lib/vawcTypes.ts VAWC_TYPES, as in 019 to 023.
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "CaseMatch" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "CaseMatchEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "CaseMatchScan" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "CaseMatch" FROM anon, authenticated;

REVOKE ALL ON "CaseMatchEvent" FROM anon, authenticated;

REVOKE ALL ON "CaseMatchScan" FROM anon, authenticated;

-- ── The values ──
ALTER TABLE "CaseMatch" DROP CONSTRAINT IF EXISTS "CaseMatch_values_check";

ALTER TABLE "CaseMatch" ADD CONSTRAINT "CaseMatch_values_check" CHECK ("caseId" <> "matchedCaseId" AND "desk" IN ('BLOTTER','VAWC') AND "classification" IN ('POTENTIAL_DUPLICATE','RELATED_CASE') AND "status" IN ('PENDING_REVIEW','FURTHER_REVIEW','VERIFIED_DUPLICATE','RELATED','NOT_DUPLICATE') AND "analysis" IN ('AI','RULES') AND "matchingEstimate" BETWEEN 0 AND 1 AND ("primaryCaseId" IS NULL OR "primaryCaseId" IN ("caseId", "matchedCaseId")) AND ("status" <> 'VERIFIED_DUPLICATE' OR ("primaryCaseId" IS NOT NULL AND "reviewedById" IS NOT NULL)) AND ("status" IN ('PENDING_REVIEW') OR "reviewedById" IS NOT NULL));

ALTER TABLE "CaseMatchEvent" DROP CONSTRAINT IF EXISTS "CaseMatchEvent_values_check";

ALTER TABLE "CaseMatchEvent" ADD CONSTRAINT "CaseMatchEvent_values_check" CHECK ("kind" IN ('detected','reviewed','redetected') AND "actorType" IN ('official','system'));

ALTER TABLE "CaseMatchScan" DROP CONSTRAINT IF EXISTS "CaseMatchScan_values_check";

ALTER TABLE "CaseMatchScan" ADD CONSTRAINT "CaseMatchScan_values_check" CHECK ("status" IN ('RUNNING','DONE','FAILED') AND "candidates" >= 0 AND "matches" >= 0);

-- ── One desk per pair: a blotter case is never paired with a VAWC case ──
CREATE OR REPLACE FUNCTION case_match_same_desk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other'))) <> (EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."matchedCaseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other'))) THEN RAISE EXCEPTION 'A case match is within one desk: a blotter case is never paired with a VAWC case'; END IF; IF NEW."desk" <> (CASE WHEN EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN 'VAWC' ELSE 'BLOTTER' END) THEN RAISE EXCEPTION 'The match desk must be the desk of its cases'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS case_match_same_desk ON "CaseMatch";

CREATE TRIGGER case_match_same_desk BEFORE INSERT OR UPDATE OF "caseId", "matchedCaseId", "desk" ON "CaseMatch" FOR EACH ROW EXECUTE FUNCTION case_match_same_desk();

REVOKE EXECUTE ON FUNCTION case_match_same_desk() FROM PUBLIC, anon, authenticated;

-- ── The history cannot be rewritten ──
CREATE OR REPLACE FUNCTION case_match_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CaseMatchEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS case_match_event_immutable ON "CaseMatchEvent";

CREATE TRIGGER case_match_event_immutable BEFORE UPDATE ON "CaseMatchEvent" FOR EACH ROW EXECUTE FUNCTION case_match_event_immutable();

REVOKE EXECUTE ON FUNCTION case_match_event_immutable() FROM PUBLIC, anon, authenticated;
