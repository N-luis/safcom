-- SafeComm 016 (after 016_evidence.schema.sql): fill in the new evidence fields
-- for photos stored before them, from relations that already exist - nothing is
-- guessed - and keep the values well-formed. No photo is changed or deleted.

-- The fingerprint of the bytes actually stored.
UPDATE "CaseAttachment" SET "sha256" = encode(sha256("data"), 'hex') WHERE "sha256" IS NULL;

-- A photo on the report itself (not a follow-up, not a hearing record) can only
-- have come with the resident's online report: that is the one route that stores
-- report-level photos. Its uploader is the resident linked to the case.
UPDATE "CaseAttachment" a
   SET "uploadedByResidentId" = c."residentId"
  FROM "Case" c
 WHERE a."caseId" = c."id"
   AND a."followUpId" IS NULL AND a."hearingId" IS NULL
   AND a."uploadedByResidentId" IS NULL AND a."uploadedByUserId" IS NULL
   AND c."residentId" IS NOT NULL;

-- A follow-up's photo was uploaded by whoever wrote the follow-up.
UPDATE "CaseAttachment" a
   SET "uploadedByResidentId" = f."residentId", "uploadedByUserId" = f."userId"
  FROM "CaseFollowUp" f
 WHERE a."followUpId" = f."id"
   AND a."uploadedByResidentId" IS NULL AND a."uploadedByUserId" IS NULL;

-- Well-formed values only.
ALTER TABLE "CaseAttachment" DROP CONSTRAINT IF EXISTS "CaseAttachment_sha256_hex";
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_sha256_hex" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CaseAttachment" DROP CONSTRAINT IF EXISTS "CaseAttachment_one_uploader";
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_one_uploader" CHECK (NOT ("uploadedByResidentId" IS NOT NULL AND "uploadedByUserId" IS NOT NULL));
ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_submissionKey_len";
ALTER TABLE "Case" ADD CONSTRAINT "Case_submissionKey_len" CHECK ("submissionKey" IS NULL OR length("submissionKey") BETWEEN 8 AND 64);

-- Both tables already have row-level security on, with nothing granted to the
-- public API roles; restated so this file is safe on its own.
ALTER TABLE "CaseAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Case" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CaseAttachment" FROM anon, authenticated;
REVOKE ALL ON "Case" FROM anon, authenticated;
