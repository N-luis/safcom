/**
 * Imports the risk classification matrices into RiskMatrixChunk.
 *
 *   npx tsx --env-file=.env scripts/ingest-risk-matrices.ts
 *   npx tsx --env-file=.env scripts/ingest-risk-matrices.ts --blotter <file.pdf> --vawc <file.pdf>
 *   npx tsx --env-file=.env scripts/ingest-risk-matrices.ts --dry-run
 *
 * Defaults to knowledge/sources/blotter-risk-matrix.pdf and
 * knowledge/sources/vawc-risk-matrix.pdf. Requires DATABASE_URL (read from
 * the environment; never printed) and prisma/sql/001_risk_matrix_knowledge_base.sql
 * applied first.
 *
 * Safe to run again:
 *   - the same file (same sha256) is a no-op;
 *   - a changed file is imported alongside, and every older version of that
 *     document is marked isCurrent = false with supersededAt set - kept for
 *     the record, never searched again, never deleted.
 * A document whose table cannot be read is reported and NOT imported. Nothing
 * is reported as imported until the database confirms the rows.
 */

import { prisma } from '../lib/prisma';
import { ingestMatrix, type DocType, type Report } from '../lib/matrixIngest';

function args() {
  const a = process.argv.slice(2);
  const val = (flag: string) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const jobs: { type: DocType; file: string }[] = [];
  if (val('--test')) jobs.push({ type: 'TEST', file: val('--test')! });
  else {
    jobs.push({ type: 'BLOTTER', file: val('--blotter') ?? 'knowledge/sources/blotter-risk-matrix.pdf' });
    jobs.push({ type: 'VAWC', file: val('--vawc') ?? 'knowledge/sources/vawc-risk-matrix.pdf' });
  }
  return { jobs, dryRun: a.includes('--dry-run') };
}

async function main() {
  const { jobs, dryRun } = args();
  const reports: Report[] = [];
  for (const j of jobs) {
    try {
      reports.push(await ingestMatrix(j.type, j.file, dryRun));
    } catch (err) {
      reports.push({ type: j.type, file: j.file, outcome: 'failed', pages: 0, chunks: 0, skippedPages: [],
        errors: [err instanceof Error ? err.message.split('\n')[0] : String(err)], inserted: 0, superseded: 0, verified: false });
    }
  }
  console.log('\nRisk matrix import' + (dryRun ? ' (dry run - nothing written)' : ''));
  for (const r of reports) {
    console.log(`\n  ${r.type.padEnd(8)} ${r.outcome.toUpperCase()}  ${r.file}`);
    console.log(`    pages ${r.pages} · chunks ${r.chunks} · inserted ${r.inserted} · superseded ${r.superseded} · verified ${r.verified}`);
    for (const s of r.skippedPages) console.log(`    skipped ${s}`);
    for (const e of r.errors) console.log(`    ERROR ${e}`);
  }
  const total = await prisma.riskMatrixChunk.groupBy({ by: ['documentType', 'isCurrent'], _count: { _all: true } }).catch(() => []);
  console.log('\n  In the database now:', total.map(t => `${t.documentType}${t.isCurrent ? '' : ' (superseded)'}: ${t._count._all}`).join(' · ') || 'nothing');
  if (reports.some(r => r.outcome === 'failed')) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
