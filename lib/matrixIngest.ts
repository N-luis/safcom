/**
 * The risk-matrix import, as a function - used by scripts/ingest-risk-matrices.ts
 * and by tests/knowledgeBase.test.ts. See the script for what it guarantees.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from './prisma';
import { extractMatrix } from './matrixExtraction';

export type DocType = 'BLOTTER' | 'VAWC' | 'TEST';

export interface Report {
  type: DocType; file: string; outcome: 'imported' | 'unchanged' | 'failed' | 'dry-run';
  pages: number; chunks: number; skippedPages: string[]; errors: string[];
  inserted: number; superseded: number; verified: boolean;
}

export async function ingestMatrix(type: DocType, file: string, dryRun = false): Promise<Report> {
  const r: Report = { type, file, outcome: 'failed', pages: 0, chunks: 0, skippedPages: [], errors: [], inserted: 0, superseded: 0, verified: false };
  if (!fs.existsSync(file)) { r.errors.push(`File not found: ${file}`); return r; }

  const bytes = fs.readFileSync(file);
  const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const ex = await extractMatrix(new Uint8Array(bytes));
  r.pages = ex.pages;
  r.chunks = ex.chunks.length;
  r.skippedPages = ex.skippedPages.map(s => `page ${s.page}: ${s.reason}`);
  r.errors.push(...ex.errors);
  if (ex.errors.length || ex.chunks.length === 0 || !ex.chunks.some(c => c.riskLevel)) {
    if (!r.errors.length) r.errors.push('No risk levels extracted');
    return r;
  }
  if (dryRun) { r.outcome = 'dry-run'; return r; }

  const already = await prisma.riskMatrixChunk.count({ where: { documentType: type, sourceHash } });
  const now = new Date();

  await prisma.$transaction(async tx => {
    if (already !== ex.chunks.length) {
      const res = await tx.riskMatrixChunk.createMany({
        data: ex.chunks.map(c => ({
          documentType: type,
          documentName: ex.documentName,
          sourceFile: path.basename(file),
          sourceHash,
          chunkIndex: c.chunkIndex,
          sectionTitle: c.sectionTitle,
          content: c.content,
          pageNumber: c.pageNumber,
          riskLevel: c.riskLevel,
          riskLabel: c.riskLabel,
          fields: c.fields ?? undefined,
          frameworkStatus: ex.frameworkStatus,
        })),
        skipDuplicates: true,
      });
      r.inserted = res.count;
    }
    // One current version per document type.
    const old = await tx.riskMatrixChunk.updateMany({
      where: { documentType: type, sourceHash: { not: sourceHash }, isCurrent: true },
      data: { isCurrent: false, supersededAt: now },
    });
    r.superseded = old.count;
    await tx.riskMatrixChunk.updateMany({
      where: { documentType: type, sourceHash },
      data: { isCurrent: true, supersededAt: null },
    });
  });

  // ── Confirm from the database, not from what was sent ──
  const [current, staleCurrent, levels] = await Promise.all([
    prisma.riskMatrixChunk.count({ where: { documentType: type, sourceHash, isCurrent: true } }),
    prisma.riskMatrixChunk.count({ where: { documentType: type, sourceHash: { not: sourceHash }, isCurrent: true } }),
    prisma.riskMatrixChunk.findMany({
      where: { documentType: type, sourceHash, riskLevel: { not: null } },
      select: { riskLevel: true }, orderBy: { riskLevel: 'asc' },
    }),
  ]);
  r.verified = current === ex.chunks.length && staleCurrent === 0
    && levels.map(l => l.riskLevel).join(',') === '1,2,3,4,5';
  if (!r.verified) r.errors.push(`Verification failed: ${current} current rows for ${ex.chunks.length} chunks, ${staleCurrent} stale rows still current, levels [${levels.map(l => l.riskLevel).join(',')}]`);
  r.outcome = !r.verified ? 'failed' : already === ex.chunks.length ? 'unchanged' : 'imported';
  return r;
}
