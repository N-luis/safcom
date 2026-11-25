-- SafeComm 030: verified streets - values, RLS and the first verified list. Apply after 030_verified_streets.schema.sql.
-- Safe to run more than once.
--   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/030_verified_streets.sql
-- Only Barangay Biñang 2nd has a verified street list (its own hazard map). Every other barangay gets manual street
-- entry until a list is added here with a source an official can point to - never from a search result or a map
-- provider's guess about which barangay a road is in.

ALTER TABLE "VerifiedStreet" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "VerifiedStreet" FROM anon, authenticated;

ALTER TABLE "VerifiedStreet" DROP CONSTRAINT IF EXISTS "VerifiedStreet_values_check";

ALTER TABLE "VerifiedStreet" ADD CONSTRAINT "VerifiedStreet_values_check" CHECK (length(trim("name")) >= 2 AND length(trim("source")) >= 5 AND "id" ~ '^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$' AND (("latitude" IS NULL) = ("longitude" IS NULL)));

-- A street chosen from a list is never also "typed by hand".
ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_street_values_check";

ALTER TABLE "Case" ADD CONSTRAINT "Case_street_values_check" CHECK ("streetId" IS NULL OR "streetManual" IS NOT TRUE);

ALTER TABLE "JurisdictionReferral" DROP CONSTRAINT IF EXISTS "JurisdictionReferral_street_values_check";

ALTER TABLE "JurisdictionReferral" ADD CONSTRAINT "JurisdictionReferral_street_values_check" CHECK ("streetId" IS NULL OR "streetManual" IS NOT TRUE);

INSERT INTO "VerifiedStreet" ("id", "province", "municipality", "barangay", "name", "aliases", "source", "latitude", "longitude") VALUES ('bulacan:bocaue:binang-2nd:ortega-compound', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Ortega Compound', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:eugenio-compound', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Eugenio Compound', ARRAY['Eudenio Compound']::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:violeta-metroville-subd', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Violeta Metroville Subd.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', 14.797899, 120.931853), ('bulacan:bocaue:binang-2nd:j-p-rizal-st', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'J.P. Rizal St.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', 14.795832, 120.929938), ('bulacan:bocaue:binang-2nd:gov-f-halili-ext', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Gov. F. Halili Ext.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:j-benedicto-st', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'J. Benedicto St.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:a-mendoza-st', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'A. Mendoza St.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', 14.797403, 120.928349), ('bulacan:bocaue:binang-2nd:p-lazaro-st', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'P. Lazaro St.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:gov-f-halili-ave', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Gov. F. Halili Ave.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', 14.799496, 120.930732), ('bulacan:bocaue:binang-2nd:ayukit', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Ayukit', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:granville-subd', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'Granville Subd.', ARRAY[]::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', NULL, NULL), ('bulacan:bocaue:binang-2nd:macarthur-highway', 'Bulacan', 'Bocaue', 'Biñang 2nd', 'MacArthur Highway', ARRAY['Mc Arthur Hi-way', 'McArthur Highway', 'MacArthur Hi-way']::text[], 'Barangay Biñang 2nd hazard map (posted at the Barangay Hall), as transcribed in lib/streets.ts', 14.795457, 120.930225) ON CONFLICT ("id") DO NOTHING;
