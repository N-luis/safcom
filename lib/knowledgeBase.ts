import 'server-only';
import { prisma } from './prisma';
import { mentions, type TermGroup } from './caseClassification';
import { MATRIX_VOCABULARY, type Framework } from './riskMatrices';

/**
 * Search over the imported risk matrices (RiskMatrixChunk), by trigram
 * similarity.
 *
 * Retrieval only. It finds the source text a decision should be checked
 * against; it never decides a level. pg_trgm compares letter sequences, not
 * meaning, so a Tagalog report shares almost nothing with the English
 * matrices - each query is therefore run alongside the matrices' own English
 * wording for any fact the report states (MATRIX_VOCABULARY). A hit below the
 * "strong" score is returned as weak, never as authoritative guidance.
 *
 * Every query is parameterised; nothing from a report is interpolated into
 * SQL. The narrative is never logged.
 */

export interface MatrixHit {
  id: string;
  documentType: Framework;
  documentName: string;
  sectionTitle: string;
  riskLevel: number | null;
  riskLabel: string | null;
  pageNumber: number | null;
  content: string;
  fields: Record<string, unknown> | null;
  score: number;
  strength: 'strong' | 'weak';
}

export type SearchStatus = 'ok' | 'empty_query' | 'no_documents' | 'no_match' | 'unavailable';

export interface SearchResult {
  status: SearchStatus;
  hits: MatrixHit[];
  /** The queries actually run, so a result can be explained. */
  queries: string[];
  message?: string;
}

export const SEARCH_DEFAULTS = {
  limit: 4,
  /** word_similarity below this is not returned at all. */
  threshold: 0.3,
  /** At or above this a hit may be shown as matching guidance. */
  strong: 0.5,
  maxQueries: 6,
};

/** The pieces of Prisma this needs - narrow, so a failing client can be tested. */
export interface KbDb {
  $queryRaw: typeof prisma.$queryRaw;
  $transaction: typeof prisma.$transaction;
}

const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();

/** The query as written, plus the matrices' wording for each fact it states. */
export function queryVariants(query: string, extraFacts: string[] = []): string[] {
  const q = normalise(query);
  const groups = Object.keys(MATRIX_VOCABULARY).filter(k => {
    try { return Boolean(mentions(query, k as TermGroup)); } catch { return false; }
  });
  const phrases = [...new Set([...extraFacts, ...groups])].flatMap(k => MATRIX_VOCABULARY[k] ?? []);
  const variants = [...(q && q.length <= 200 ? [q] : q ? [q.slice(0, 200)] : []), ...phrases];
  return [...new Set(variants)].slice(0, SEARCH_DEFAULTS.maxQueries);
}

export async function searchMatrix(
  type: Framework,
  query: string,
  opts: { limit?: number; threshold?: number; facts?: string[] } = {},
  db: KbDb = prisma,
): Promise<SearchResult> {
  const limit = Math.min(10, Math.max(1, opts.limit ?? SEARCH_DEFAULTS.limit));
  const threshold = opts.threshold ?? SEARCH_DEFAULTS.threshold;
  const queries = queryVariants(query ?? '', opts.facts ?? []);
  if (!queries.length) return { status: 'empty_query', hits: [], queries, message: 'Nothing to search for.' };

  try {
    return await db.$transaction(async tx => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "RiskMatrixChunk" WHERE "documentType" = ${type} AND "isCurrent" = true`;
      if (Number(n) === 0) {
        return { status: 'no_documents' as const, hits: [], queries,
          message: `The ${type} matrix has not been imported. Run scripts/ingest-risk-matrices.ts.` };
      }

      // Scoped to this transaction: the % operators read this threshold.
      await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(threshold)}, true)`;

      const best = new Map<string, MatrixHit>();
      for (const q of queries) {
        const rows = await tx.$queryRaw<(Omit<MatrixHit, 'strength' | 'score'> & { score: number })[]>`
          SELECT id, "documentType", "documentName", "sectionTitle", "riskLevel", "riskLabel",
                 "pageNumber", content, fields, word_similarity(${q}, content) AS score
          FROM "RiskMatrixChunk"
          WHERE "documentType" = ${type} AND "isCurrent" = true AND ${q} <% content
          ORDER BY score DESC
          LIMIT ${limit}`;
        for (const r of rows) {
          const score = Number(r.score);
          const prev = best.get(r.id);
          if (!prev || score > prev.score) {
            best.set(r.id, { ...r, score, strength: score >= SEARCH_DEFAULTS.strong ? 'strong' : 'weak' });
          }
        }
      }
      const hits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
      return hits.length
        ? { status: 'ok' as const, hits, queries }
        : { status: 'no_match' as const, hits, queries, message: 'No part of the matrix is similar enough to cite.' };
    });
  } catch (err) {
    console.error('[knowledgeBase] search failed:', err instanceof Error ? err.message.split('\n')[0] : 'error');
    return { status: 'unavailable', hits: [], queries, message: 'The matrix knowledge base could not be reached.' };
  }
}

/** The stored row for one level of a matrix, for showing its source text. */
export async function levelChunk(type: Framework, level: number, db: KbDb = prisma): Promise<MatrixHit | null> {
  try {
    const rows = await db.$queryRaw<(Omit<MatrixHit, 'strength' | 'score'>)[]>`
      SELECT id, "documentType", "documentName", "sectionTitle", "riskLevel", "riskLabel",
             "pageNumber", content, fields
      FROM "RiskMatrixChunk"
      WHERE "documentType" = ${type} AND "isCurrent" = true AND "riskLevel" = ${level}
      ORDER BY "importedAt" DESC
      LIMIT 1`;
    return rows[0] ? { ...rows[0], score: 1, strength: 'strong' } : null;
  } catch {
    return null;
  }
}
