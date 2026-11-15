/**
 * Metrics for the classification evaluation: confusion matrices, per-class
 * precision / recall / F1, and the safety counts. Pure functions - no
 * database, no AI - so they are tested on their own (tests/evalMetrics.test.ts).
 */

export interface ClassReport { label: string; support: number; predicted: number; tp: number; precision: number | null; recall: number | null; f1: number | null }

export interface Confusion {
  labels: string[];
  /** matrix[expected][predicted] */
  matrix: Record<string, Record<string, number>>;
  perClass: ClassReport[];
  accuracy: number;
  macroF1: number | null;
  total: number;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A confusion matrix over (expected, predicted) pairs. Precision is null for a
 * class never predicted, recall null for a class never expected - not 0,
 * which would read as a measured failure.
 */
export function confusion(pairs: { expected: string; predicted: string }[], order: string[] = []): Confusion {
  const labels = [...new Set([...order, ...pairs.map(p => p.expected), ...pairs.map(p => p.predicted)])];
  const matrix: Confusion['matrix'] = Object.fromEntries(labels.map(e => [e, Object.fromEntries(labels.map(p => [p, 0]))]));
  for (const p of pairs) matrix[p.expected][p.predicted]++;
  const perClass = labels.map(label => {
    const tp = matrix[label][label];
    const support = labels.reduce((n, p) => n + matrix[label][p], 0);
    const predicted = labels.reduce((n, e) => n + matrix[e][label], 0);
    const precision = predicted ? tp / predicted : null;
    const recall = support ? tp / support : null;
    const f1 = precision !== null && recall !== null ? (precision + recall ? (2 * precision * recall) / (precision + recall) : 0) : null;
    return { label, support, predicted, tp, precision: precision === null ? null : round(precision), recall: recall === null ? null : round(recall), f1: f1 === null ? null : round(f1) };
  });
  const correct = labels.reduce((n, l) => n + matrix[l][l], 0);
  return {
    labels, matrix, perClass,
    accuracy: pairs.length ? round(correct / pairs.length) : 0,
    // Over classes that were expected at least once; a never-predicted expected class counts as F1 0.
    macroF1: perClass.some(c => c.support > 0)
      ? round(perClass.filter(c => c.support > 0).reduce((n, c) => n + (c.f1 ?? 0), 0) / perClass.filter(c => c.support > 0).length)
      : null,
    total: pairs.length,
  };
}

/** Levels as labels: "none" for an undetermined level. */
export const levelLabel = (l: number | null | undefined) => (l === null || l === undefined ? 'none' : `L${l}`);
export const LEVEL_ORDER = ['none', 'L1', 'L2', 'L3', 'L4', 'L5'];

/** Expected vs predicted level: exact, within an accepted alternative, adjacent (off by one), or other. */
export function levelAgreement(expected: number | null, acceptable: (number | null)[], predicted: number | null) {
  if (predicted === expected) return 'exact' as const;
  if (acceptable.includes(predicted)) return 'accepted' as const;
  if (expected !== null && predicted !== null && Math.abs(expected - predicted) === 1) return 'adjacent' as const;
  return 'wrong' as const;
}

/** Markdown table for a confusion matrix. */
export function confusionTable(c: Confusion, title: string): string {
  const head = `| expected \\ predicted | ${c.labels.join(' | ')} |`;
  const sep = `|---|${c.labels.map(() => '---:').join('|')}|`;
  const rows = c.labels.filter(e => c.labels.some(p => c.matrix[e][p] > 0))
    .map(e => `| **${e}** | ${c.labels.map(p => (c.matrix[e][p] ? (e === p ? `**${c.matrix[e][p]}**` : String(c.matrix[e][p])) : '·')).join(' | ')} |`);
  const pc = ['| class | support | predicted | precision | recall | F1 |', '|---|---:|---:|---:|---:|---:|',
    ...c.perClass.filter(x => x.support || x.predicted).map(x =>
      `| ${x.label} | ${x.support} | ${x.predicted} | ${x.precision ?? 'n/a'} | ${x.recall ?? 'n/a'} | ${x.f1 ?? 'n/a'} |`)];
  return [`#### ${title}`, '', `Accuracy ${c.accuracy} over ${c.total} cases; macro-F1 ${c.macroF1 ?? 'n/a'}.`, '', head, sep, ...rows, '', ...pc, ''].join('\n');
}
