/**
 * How SafeComm's preliminary readings compare with what officials decided -
 * counts only, for finding recurring classification errors.
 *
 *   npx tsx --env-file=.env --conditions=react-server scripts/review-outcomes.ts
 *
 * Read-only. Prints no narrative, no name, no reason text and no case number:
 * only category and level pairs and how often each occurs. An official's
 * decision is not automatically a correct label - these counts point to where
 * to look; any case used as an evaluation example must be de-identified and
 * its use authorised (tests/eval/README.md).
 */
import { prisma } from '../lib/prisma';

async function main() {
  const rows = await prisma.assessmentHistory.findMany({
    where: { kind: { in: ['preliminary', 'category_confirm', 'category_change', 'officer_confirm', 'officer_override'] } },
    orderBy: { createdAt: 'asc' },
    select: { caseId: true, kind: true, caseType: true, previousCaseType: true, riskLevel: true },
  });
  const byCase = new Map<string, typeof rows>();
  for (const r of rows) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);

  const category = new Map<string, number>();
  const level = new Map<string, number>();
  let withPrelim = 0, categoryReviewed = 0, levelReviewed = 0;
  for (const list of byCase.values()) {
    const pre = list.find(r => r.kind === 'preliminary');
    if (!pre) continue;
    withPrelim++;
    const cat = [...list].reverse().find(r => r.kind === 'category_change' || r.kind === 'category_confirm');
    if (cat) {
      categoryReviewed++;
      const k = `${pre.caseType ?? '(none)'} -> ${cat.caseType ?? '(none)'}`;
      category.set(k, (category.get(k) ?? 0) + 1);
    }
    const lv = [...list].reverse().find(r => r.kind === 'officer_override' || r.kind === 'officer_confirm');
    if (lv) {
      levelReviewed++;
      const k = `${pre.riskLevel ?? 'undetermined'} -> ${lv.riskLevel ?? 'undetermined'}`;
      level.set(k, (level.get(k) ?? 0) + 1);
    }
  }
  const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}${k.split(' -> ')[0] === k.split(' -> ')[1] ? '  (agreed)' : ''}`).join('\n') || '  (none)';
  console.log(`Cases with a preliminary SafeComm reading: ${withPrelim}`);
  console.log(`\nCategory: preliminary -> official's decision (${categoryReviewed} reviewed)\n${show(category)}`);
  console.log(`\nQueue level: preliminary -> official's decision (${levelReviewed} reviewed)\n${show(level)}`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
