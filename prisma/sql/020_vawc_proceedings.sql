-- SafeComm 020: VAWC Hearings and VAWC Case Proceedings - closed to the public
-- API roles, values the database itself checks, VAWC cases only, and a history
-- that cannot be rewritten. Safe to run more than once. Run after
-- 019_vawc_appointments.sql and 020_vawc_proceedings.schema.sql:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/020_vawc_proceedings.sql
--
-- The values are lib/vawcAppointments.ts and lib/vawcProceedings.ts;
-- tests/vawcProceedingsRules.test.ts fails if they ever differ. The VAWC
-- categories are lib/vawcTypes.ts VAWC_TYPES, as in 019.
-- (scripts/run-sql.ts splits on a semicolon at the end of a line, so each
-- function body is kept on one line.)

-- ── VAWC Hearings (VawcAppointment): one more type, the court's, tracked only ──
-- Replaces 019's check with the same rules plus EXTERNAL_COURT_HEARING, whose
-- matter and source are required - and which no other type may carry. Still no
-- mediation, conciliation or joint session type, and no respondent participant.
ALTER TABLE "VawcAppointment" DROP CONSTRAINT IF EXISTS "VawcAppointment_values_check";
ALTER TABLE "VawcAppointment" ADD CONSTRAINT "VawcAppointment_values_check" CHECK ("type" IN ('VICTIM_INTERVIEW','INTAKE_FOLLOW_UP','SAFETY_FOLLOW_UP','REFERRAL_COORDINATION','CASE_CONFERENCE','EXTERNAL_COURT_HEARING') AND "status" IN ('SCHEDULED','RESCHEDULED','COMPLETED','NOT_HELD','CANCELLED') AND "notifyVia" IN ('SAFECOMM_ACCOUNT','OFFICER_CONTACT','NONE') AND cardinality("participants") > 0 AND "participants" <@ ARRAY['REPORTER','VICTIM_SURVIVOR','SUPPORT_PERSON','SERVICE_PROVIDER','VAWC_STAFF']::text[] AND ("attendance" IS NULL OR "attendance" IN ('ATTENDED','DID_NOT_ATTEND','NOT_APPLICABLE')) AND ("referralStatus" IS NULL OR "referralStatus" IN ('NOT_NEEDED','TO_BE_MADE','IN_PROGRESS','COMPLETED','DECLINED_BY_CLIENT')) AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)) AND (("status" IN ('COMPLETED','NOT_HELD')) = ("completedAt" IS NOT NULL)) AND ("type" <> 'EXTERNAL_COURT_HEARING' OR ("courtMatter" IS NOT NULL AND "courtSource" IS NOT NULL)) AND ("type" = 'EXTERNAL_COURT_HEARING' OR ("courtMatter" IS NULL AND "courtSource" IS NULL AND "courtReference" IS NULL)) AND ("courtMatter" IS NULL OR "courtMatter" IN ('TPO','PPO','CRIMINAL_CASE','OTHER')) AND ("courtSource" IS NULL OR "courtSource" IN ('COURT_NOTICE','PROSECUTOR_OR_PAO','PNP_WCPD','SWDO','CLIENT_COPY')));

-- ── Row level security: no access through the public API roles ──
ALTER TABLE "VawcBpo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VawcReferral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VawcProceedingEvent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "VawcBpo" FROM anon, authenticated;
REVOKE ALL ON "VawcReferral" FROM anon, authenticated;
REVOKE ALL ON "VawcProceedingEvent" FROM anon, authenticated;

-- ── A BPO: its values, and its three parts in order ──
-- Applied -> issued or not issued (ex parte, with the Kagawad attestation when
-- a Kagawad decided) -> served (only once issued). Recorded in error stands apart.
ALTER TABLE "VawcBpo" DROP CONSTRAINT IF EXISTS "VawcBpo_values_check";
ALTER TABLE "VawcBpo" ADD CONSTRAINT "VawcBpo_values_check" CHECK ("status" IN ('APPLIED','ISSUED','SERVED','DENIED','CANCELLED') AND "applicantType" IN ('VICTIM_SURVIVOR','PARENT_GUARDIAN','RELATIVE','SOCIAL_WORKER','POLICE','BARANGAY_OFFICIAL','PROFESSIONAL','CONCERNED_CITIZENS') AND ("decision" IS NULL OR "decision" IN ('ISSUED','DENIED')) AND (("decision" IS NULL) = ("decidedAt" IS NULL)) AND ("actingRole" IS NULL OR "actingRole" IN ('PUNONG_BARANGAY','KAGAWAD')) AND ("actingRole" IS DISTINCT FROM 'KAGAWAD' OR "punongBarangayUnavailable") AND ("serviceMethod" IS NULL OR "serviceMethod" IN ('PERSONAL','REFUSED','OTHER')) AND ("servedAt" IS NULL OR "decision" = 'ISSUED') AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)) AND ("status" <> 'APPLIED' OR "decision" IS NULL) AND ("status" <> 'ISSUED' OR ("decision" = 'ISSUED' AND "servedAt" IS NULL)) AND ("status" <> 'SERVED' OR ("decision" = 'ISSUED' AND "servedAt" IS NOT NULL)) AND ("status" <> 'DENIED' OR "decision" = 'DENIED'));

-- ── A referral ──
ALTER TABLE "VawcReferral" DROP CONSTRAINT IF EXISTS "VawcReferral_values_check";
ALTER TABLE "VawcReferral" ADD CONSTRAINT "VawcReferral_values_check" CHECK ("agencyType" IN ('PNP_WCPD','SWDO','HEALTH','LEGAL','SHELTER','OTHER') AND "status" IN ('REFERRED','ACKNOWLEDGED','IN_PROGRESS','COMPLETED','DECLINED_BY_CLIENT','NO_RESPONSE') AND length(trim("agencyName")) > 0);

ALTER TABLE "VawcProceedingEvent" DROP CONSTRAINT IF EXISTS "VawcProceedingEvent_kind_check";
ALTER TABLE "VawcProceedingEvent" ADD CONSTRAINT "VawcProceedingEvent_kind_check" CHECK ("recordKind" IN ('bpo','referral','appointment') AND ("recordKind" <> 'appointment' OR "kind" = 'reminder_sent'));

-- ── On a VAWC case, and staying on it ──
CREATE OR REPLACE FUNCTION vawc_proceeding_case_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'UPDATE' AND NEW."caseId" IS DISTINCT FROM OLD."caseId" THEN RAISE EXCEPTION 'A VAWC proceeding record cannot be moved to another case'; END IF; IF NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."id" = NEW."caseId" AND c."caseType" IN ('Domestic Violence','Physical Abuse','Sexual Harassment','Child Abuse','Stalking','Emotional Abuse','Economic Abuse','Sexual Violence','Human Trafficking','VAWC - Other')) THEN RAISE EXCEPTION 'VAWC proceeding records are for VAWC cases only'; END IF; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS vawc_bpo_case_check ON "VawcBpo";

CREATE TRIGGER vawc_bpo_case_check BEFORE INSERT OR UPDATE ON "VawcBpo" FOR EACH ROW EXECUTE FUNCTION vawc_proceeding_case_check();

DROP TRIGGER IF EXISTS vawc_referral_case_check ON "VawcReferral";

CREATE TRIGGER vawc_referral_case_check BEFORE INSERT OR UPDATE ON "VawcReferral" FOR EACH ROW EXECUTE FUNCTION vawc_proceeding_case_check();

-- ── The history cannot be rewritten (it outlives a deleted record, like the access log) ──
CREATE OR REPLACE FUNCTION vawc_proceeding_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VawcProceedingEvent rows cannot be changed'; END $$;

DROP TRIGGER IF EXISTS vawc_proceeding_event_immutable ON "VawcProceedingEvent";

CREATE TRIGGER vawc_proceeding_event_immutable BEFORE UPDATE ON "VawcProceedingEvent" FOR EACH ROW EXECUTE FUNCTION vawc_proceeding_event_immutable();

REVOKE EXECUTE ON FUNCTION vawc_proceeding_case_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vawc_proceeding_event_immutable() FROM PUBLIC, anon, authenticated;
