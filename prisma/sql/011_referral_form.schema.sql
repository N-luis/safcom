-- SafeComm 011: Annex B - Referral Form fields on a referral. Additive only:
-- nullable columns, so every referral recorded before stays as it is.
-- Reviewed output of:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/011_referral_form.schema.sql
-- Then:    npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/011_referral_form.sql


-- AlterTable
ALTER TABLE "CaseReferral" ADD COLUMN     "clientAddress" TEXT,
ADD COLUMN     "clientAge" INTEGER,
ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "clientSex" TEXT,
ADD COLUMN     "feedbackAddress" TEXT,
ADD COLUMN     "feedbackCellPhone" TEXT,
ADD COLUMN     "feedbackContact" TEXT,
ADD COLUMN     "feedbackEmail" TEXT,
ADD COLUMN     "feedbackFax" TEXT,
ADD COLUMN     "feedbackLandline" TEXT,
ADD COLUMN     "feedbackTo" TEXT,
ADD COLUMN     "formUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "formUpdatedById" TEXT,
ADD COLUMN     "guardianAddress" TEXT,
ADD COLUMN     "guardianContact" TEXT,
ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "referredByDesignation" TEXT,
ADD COLUMN     "referredByName" TEXT,
ADD COLUMN     "servicesRequested" TEXT,
ADD COLUMN     "toAddress" TEXT,
ADD COLUMN     "toContactPerson" TEXT;

