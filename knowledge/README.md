# Risk-matrix knowledge base

SafeComm assesses reports against two source documents, kept in `sources/`:

| Type | File | Document |
|---|---|---|
| `BLOTTER` | `sources/blotter-risk-matrix.pdf` | Barangay Blotter Matrix |
| `VAWC` | `sources/vawc-risk-matrix.pdf` | Proposed Incident Risk Classification Matrix (Philippine Context) |

Both are operational triage frameworks, not law. The VAWC document states that its five levels are "a proposed operational risk-stratification framework … not an official five-level classification prescribed by Philippine law"; the Blotter document that its levels "do not establish legal guilt".

## Setup (once per database)

Requires `DATABASE_URL` in `.env` (never printed by these scripts).

```bash
npm run kb:setup     # installs pg_trgm (extensions schema), creates RiskMatrixChunk + indexes; safe to repeat
npm run kb:ingest    # extracts both PDFs and imports them; safe to repeat
```

`prisma db push` after setup reports the database already in sync — the table and its trigram index are also declared in `prisma/schema.prisma`, so a push never drops them.

## Updating a document

Replace the PDF in `sources/` and run `npm run kb:ingest` again. The new version is imported, every older version of that document is marked `isCurrent = false` with `supersededAt` set (kept, never searched), and the import is verified from the database before it is reported. The same file twice is a no-op.

To import from elsewhere: `npx tsx --env-file=.env scripts/ingest-risk-matrices.ts --blotter <file> --vawc <file>`; add `--dry-run` to extract without writing.

**If a document's wording changes**, `npm run test:matrices` will fail until `lib/riskMatrices.ts` is updated to match — the rules there must use the document's exact labels and indicators.

## How it is used

- `lib/riskMatrices.ts` — each level's label and indicators, verbatim, and which reported facts meet each indicator. The highest level with a met indicator is the level; none met = no level (`NEEDS_MORE_INFORMATION` or `FOR_REVIEW`).
- `lib/knowledgeBase.ts` — `searchMatrix()` (pg_trgm `word_similarity`, parameterised). Retrieval cites and checks the source; it never sets a level.
- `lib/intakeServer.ts` — runs the assessment, cites the matching level's row, and records whether the matched criteria appear word for word in the imported text (`sourceVerified`).

No external AI provider is used. Nothing from a report leaves the server.

## Tests

```bash
npm run test:matrices   # rules vs. the PDFs, and the specification's scenarios (no database)
npm run test:kb         # retrieval, failures, duplicate and revised imports (needs DATABASE_URL)
```

## Limitations

- pg_trgm matches letters, not meaning. Tagalog reports are searched with the matrices' own English wording for each fact the report states (`MATRIX_VOCABULARY`); a fact the vocabulary does not cover will not be found by search. `pgvector` is available on this database if semantic search is wanted later.
- Indicators no report fact can show ("minor policy violation", "severe criminal violations") are never matched automatically; an officer decides them.
- The matrices are applied as written. Under them a single reported push by a partner is VAWC Level 4 ("Physical assault") and any theft is Blotter Level 4 ("theft or robbery").
- Scanned PDFs (no text layer) are reported and skipped; OCR of PDF pages is not set up.
