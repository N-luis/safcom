-- SafeComm 021: KP Forms on the Walk-in Report - one new table, kp_form_records.
-- Additive only: nothing existing changes. Generated with `prisma migrate diff`
-- from the previous schema to this one, reviewed. Run:
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/021_kp_forms.schema.sql
-- Then the safeguards: prisma/sql/021_kp_forms.sql

CREATE TABLE "kp_form_records" (
    "id" TEXT NOT NULL,
    "walk_in_report_id" TEXT NOT NULL,
    "form_type" TEXT NOT NULL,
    "case_no" TEXT,
    "data" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kp_form_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kp_form_records_walk_in_report_id_updated_at_idx" ON "kp_form_records"("walk_in_report_id", "updated_at");

ALTER TABLE "kp_form_records" ADD CONSTRAINT "kp_form_records_walk_in_report_id_fkey" FOREIGN KEY ("walk_in_report_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

