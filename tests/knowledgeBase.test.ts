/**
 * The risk-matrix knowledge base, against the real database.
 * Run with:  npm run test:kb   (needs DATABASE_URL, and the matrices imported)
 *
 * Import tests use documentType "TEST" so they can never supersede the real
 * BLOTTER or VAWC rows, and every TEST row is deleted at the end.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../lib/prisma';
import { searchMatrix, levelChunk, type KbDb } from '../lib/knowledgeBase';
import { ingestMatrix } from '../lib/matrixIngest';
import { runIntake } from '../lib/intakeServer';
import type { Framework } from '../lib/riskMatrices';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

/** A client whose every call fails, as a dropped connection would. */
const brokenDb = {
  $queryRaw: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
  $transaction: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
} as KbDb;

async function main() {
  console.log('1. both documents are imported and current');
  for (const t of ['BLOTTER', 'VAWC'] as Framework[]) {
    const rows = await prisma.riskMatrixChunk.findMany({ where: { documentType: t, isCurrent: true } });
    const levels = rows.filter(r => r.riskLevel).map(r => r.riskLevel).sort().join(',');
    ok(`${t}: chunks present (${rows.length})`, rows.length >= 10);
    ok(`${t}: levels 1-5 present`, levels === '1,2,3,4,5', levels);
    ok(`${t}: one source version current`, new Set(rows.map(r => r.sourceHash)).size === 1);
  }
  const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes WHERE tablename = 'RiskMatrixChunk' AND indexname = 'RiskMatrixChunk_content_idx'`;
  ok('the GIN trigram index exists', /USING gin \(content gin_trgm_ops\)/.test(idx[0]?.indexdef ?? ''), idx[0]?.indexdef);
  const plan = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('enable_seqscan', 'off', true)`;
    return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`EXPLAIN SELECT id FROM "RiskMatrixChunk" WHERE ${'physical assault'} <% content`;
  });
  ok('the similarity search can use it', plan.some(r => r['QUERY PLAN'].includes('RiskMatrixChunk_content_idx')),
    plan.map(r => r['QUERY PLAN']).join(' | '));

  console.log('\n2. retrieval, in English and Tagalog');
  const cases: [Framework, string, number][] = [
    ['VAWC', 'my husband choked me', 4],
    ['VAWC', 'Sinakal ako ng asawa ko', 4],
    ['VAWC', 'he keeps texting me and following me home', 2],
    ['VAWC', 'Text nang text siya at sinusundan ako pauwi', 2],
    ['BLOTTER', 'my neighbour owes me money', 2],
    ['BLOTTER', 'May utang sa akin ang kapitbahay', 2],
    ['BLOTTER', 'Ninakaw ang bisikleta ko', 4],
  ];
  for (const [t, q, level] of cases) {
    const r = await searchMatrix(t, q, { limit: 3 });
    ok(`[${t}] "${q}" -> level ${level} as a strong hit`,
      r.status === 'ok' && r.hits[0]?.riskLevel === level && r.hits[0]?.strength === 'strong',
      `${r.status} ${r.hits.map(h => `L${h.riskLevel}:${h.score.toFixed(2)}`).join(' ')}`);
  }
  ok('searches stay inside their document type',
    (await searchMatrix('BLOTTER', 'Sinakal ako ng asawa ko')).hits.every(h => h.documentType === 'BLOTTER'));

  console.log('\n3. edge cases');
  ok('no relevant result -> no_match, nothing returned', (await searchMatrix('BLOTTER', 'zzqx lorem foobar')).status === 'no_match');
  ok('empty search -> empty_query', (await searchMatrix('VAWC', '   ')).status === 'empty_query');
  ok('a document that was never imported -> no_documents',
    (await searchMatrix('TEST' as Framework, 'physical assault')).status === 'no_documents');
  const down = await searchMatrix('VAWC', 'physical assault', {}, brokenDb);
  ok('a database failure -> unavailable, not a crash', down.status === 'unavailable' && down.hits.length === 0);
  ok('...and no source row is returned either', (await levelChunk('VAWC', 4, brokenDb)) === null);

  console.log('\n4. the assessment is checked against the source');
  const grounded = await runIntake({ residentId: 'no-such-resident', narrative: 'Sinakal ako ng asawa ko kagabi.' });
  ok('VAWC L4, and the matched criteria are found in the stored source row',
    grounded.result.matrixLevel === 4 && grounded.grounding.sourceVerified === true,
    `L${grounded.result.matrixLevel} verified=${grounded.grounding.sourceVerified}`);
  ok('the level-4 row is cited', grounded.grounding.references.some(r => r.riskLevel === 4 && r.suggestedAction?.startsWith('Treat as an emergency')));
  ok('the assessment says how it was made', /rule-based; no external AI provider/.test(grounded.grounding.assessedBy));
  const offline = await runIntake({ residentId: 'no-such-resident', narrative: 'Sinakal ako ng asawa ko kagabi.' }, brokenDb);
  ok('with the knowledge base down, the assessment still completes', offline.result.matrixLevel === 4);
  ok('...marked unchecked and sent for review', offline.grounding.knowledgeBaseStatus === 'unavailable'
    && offline.grounding.sourceVerified === null && offline.result.requiresOfficerReview);

  console.log('\n5. importing is safe to repeat, and versions do not mix');
  await prisma.riskMatrixChunk.deleteMany({ where: { documentType: 'TEST' } });
  const first = await ingestMatrix('TEST', 'knowledge/sources/blotter-risk-matrix.pdf');
  ok('first import inserts and verifies', first.outcome === 'imported' && first.inserted === 11 && first.verified, JSON.stringify(first));
  const again = await ingestMatrix('TEST', 'knowledge/sources/blotter-risk-matrix.pdf');
  ok('the same file again changes nothing', again.outcome === 'unchanged' && again.inserted === 0, JSON.stringify(again));
  ok('...no duplicate rows', await prisma.riskMatrixChunk.count({ where: { documentType: 'TEST' } }) === 11);

  // A revised document: same content, different bytes, so a different hash.
  const revised = path.join(os.tmpdir(), `safecomm-matrix-rev-${process.pid}.pdf`);
  fs.writeFileSync(revised, Buffer.concat([fs.readFileSync('knowledge/sources/blotter-risk-matrix.pdf'), Buffer.from('\n% revision\n')]));
  const updated = await ingestMatrix('TEST', revised);
  fs.unlinkSync(revised);
  ok('a revised file is imported', updated.outcome === 'imported' && updated.superseded === 11, JSON.stringify(updated));
  const current = await prisma.riskMatrixChunk.findMany({ where: { documentType: 'TEST', isCurrent: true }, select: { sourceHash: true } });
  const stale = await prisma.riskMatrixChunk.findMany({ where: { documentType: 'TEST', isCurrent: false }, select: { supersededAt: true } });
  ok('only the new version is current', current.length === 11 && new Set(current.map(c => c.sourceHash)).size === 1);
  ok('the old version is kept, marked superseded', stale.length === 11 && stale.every(r => r.supersededAt));
  const currentIds = new Set((await prisma.riskMatrixChunk.findMany({
    where: { documentType: 'TEST', isCurrent: true }, select: { id: true },
  })).map(r => r.id));
  const afterRevision = await searchMatrix('TEST' as Framework, 'theft or robbery', { limit: 10 });
  ok('search returns hits only from the current version',
    afterRevision.status === 'ok' && afterRevision.hits.length > 0 && afterRevision.hits.every(h => currentIds.has(h.id)),
    `${afterRevision.status} ${afterRevision.hits.map(h => currentIds.has(h.id)).join(',')}`);
  const missing = await ingestMatrix('TEST', 'knowledge/sources/no-such-file.pdf');
  ok('a missing file is reported, not imported', missing.outcome === 'failed' && /not found/.test(missing.errors[0] ?? ''));

  await prisma.riskMatrixChunk.deleteMany({ where: { documentType: 'TEST' } });
  ok('test rows removed; the real matrices untouched',
    await prisma.riskMatrixChunk.count({ where: { documentType: 'TEST' } }) === 0
    && await prisma.riskMatrixChunk.count({ where: { documentType: { in: ['BLOTTER', 'VAWC'] }, isCurrent: true } }) === 24);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
