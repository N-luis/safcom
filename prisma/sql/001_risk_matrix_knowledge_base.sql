-- SafeComm risk-matrix knowledge base.
--
-- Safe to run more than once: every statement is IF NOT EXISTS, and nothing
-- is dropped or altered. The table and index names match what Prisma
-- generates for the RiskMatrixChunk model in schema.prisma, so `prisma db
-- push` afterwards reports the database as already in sync.
--
-- Run with:  npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/001_risk_matrix_knowledge_base.sql

-- Trigram search. Supabase keeps extensions in the "extensions" schema, which
-- is on the default search_path, so gin_trgm_ops and the % / <% operators
-- resolve without qualification.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- One row per chunk of a source matrix: a risk-level row of the table, or a
-- block of notes around it. A re-import of the same file is a no-op (the
-- unique key below); an import of a changed file marks the older rows
-- isCurrent = false rather than deleting them, so search never mixes
-- versions and the history of what the system relied on is kept.
CREATE TABLE IF NOT EXISTS "RiskMatrixChunk" (
  "id"              TEXT         NOT NULL,
  "documentType"    TEXT         NOT NULL,            -- BLOTTER | VAWC | TEST
  "documentName"    TEXT         NOT NULL,
  "sourceFile"      TEXT         NOT NULL,
  "sourceHash"      TEXT         NOT NULL,            -- sha256 of the source file
  "chunkIndex"      INTEGER      NOT NULL,
  "sectionTitle"    TEXT         NOT NULL,
  "content"         TEXT         NOT NULL,            -- the searchable text
  "pageNumber"      INTEGER,
  "riskLevel"       INTEGER,                          -- 1..5 when the chunk is a level row
  "riskLabel"       TEXT,                             -- the label exactly as the document gives it
  "fields"          JSONB,                            -- the row's columns, by heading
  "frameworkStatus" TEXT         NOT NULL,
  "isCurrent"       BOOLEAN      NOT NULL DEFAULT true,
  "importedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt"    TIMESTAMP(3),
  CONSTRAINT "RiskMatrixChunk_pkey" PRIMARY KEY ("id")
);

-- No accidental duplicate imports.
CREATE UNIQUE INDEX IF NOT EXISTS "RiskMatrixChunk_documentType_sourceHash_chunkIndex_key"
  ON "RiskMatrixChunk" ("documentType", "sourceHash", "chunkIndex");

-- The filters every search applies.
CREATE INDEX IF NOT EXISTS "RiskMatrixChunk_documentType_isCurrent_idx"
  ON "RiskMatrixChunk" ("documentType", "isCurrent");
CREATE INDEX IF NOT EXISTS "RiskMatrixChunk_riskLevel_idx"
  ON "RiskMatrixChunk" ("riskLevel");

-- Trigram search over the text.
CREATE INDEX IF NOT EXISTS "RiskMatrixChunk_content_idx"
  ON "RiskMatrixChunk" USING GIN ("content" gin_trgm_ops);
