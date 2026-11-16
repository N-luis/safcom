-- SafeComm 015: indexes for the case search bar (lib/caseSearch.ts). Additive only:
-- no table, column or row changes. pg_trgm (already installed) serves the partial,
-- case-insensitive matches (ILIKE '%...%') on the reference, the reporter's name and
-- a party's name; a btree serves the exact incident-date match.
-- Reviewed output of:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- Apply:   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/015_case_search.schema.sql

-- CreateIndex
CREATE INDEX "Case_incidentDate_idx" ON "Case"("incidentDate");

-- CreateIndex
CREATE INDEX "Case_caseNumber_trgm_idx" ON "Case" USING GIN ("caseNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Case_residentName_trgm_idx" ON "Case" USING GIN ("residentName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "CaseParty_fullName_trgm_idx" ON "CaseParty" USING GIN ("fullName" gin_trgm_ops);
