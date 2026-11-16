/**
 * Runs the classification evaluation set (tests/eval/classificationDataset.json)
 * through the SAME pipeline the resident filing route uses - runIntake (rules,
 * Groq reading, matrix retrieval) and deskFor (desk recommendation) - and
 * scores it against the set's reviewed labels.
 *
 *   npx tsx --env-file=.env --conditions=react-server scripts/eval-classification.ts --mode rules
 *   npx tsx --env-file=.env --conditions=react-server scripts/eval-classification.ts --mode ai
 *
 * Modes:
 *   rules       the rules alone (as when the AI is not asked)
 *   ai          live Groq, the production model and prompts. Uses the real daily
 *               budget; stops calling Groq when fewer than --reserve tokens of
 *               today's budget would be left, and reports those cases as skipped.
 *   ai-down     Groq unreachable (every request fails) - the failure path
 *   ai-invalid  Groq answers out of shape - the invalid-output path
 * Options: --ids a,b  --tags long,vawc  --reserve 20000  --label text
 *
 * Writes tests/eval/results/<timestamp>-<mode>.{json,md}. Nothing is written to
 * cases; no narrative is logged anywhere but the result files, and every
 * narrative in the set is fictional.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { runIntake, NARRATIVE_MAX } from '../lib/intakeServer';
import { deskFor, RETRY_MAX_WAIT_MS } from '../lib/reportDeskServer';
import { triageStatusFor, type IntakeAnswer } from '../lib/intake';
import { aiConfig, dayKey, type UsageStore, type ReadDeps } from '../lib/aiClassifier';
import { confusion, confusionTable, levelAgreement, levelLabel, LEVEL_ORDER } from '../tests/eval/metrics';

type Desk = 'BLOTTER' | 'VAWC' | 'NEEDS_CLARIFICATION' | 'NEEDS_OFFICER_REVIEW';
interface EvalCase {
  id: string; tags: string[]; relationship: 'SELF' | 'THIRD_PARTY' | 'ON_BEHALF' | 'ANONYMOUS';
  narrative: string; answers?: IntakeAnswer[];
  expected: {
    desk: Desk; acceptableDesks?: Desk[]; caseTypes: string[]; level: number | null; acceptableLevels?: (number | null)[];
    urgent: boolean; needsClarification: boolean | null;
  };
  basis: string;
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const mode = (arg('mode') ?? 'rules') as 'rules' | 'ai' | 'ai-down' | 'ai-invalid';
const reserve = Number(arg('reserve') ?? 20000);
const label = arg('label') ?? '';
const root = path.resolve(__dirname, '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'tests/eval/classificationDataset.json'), 'utf8')) as { version: number; reviewStatus: string; cases: EvalCase[] };
let cases = dataset.cases;
if (arg('ids')) { const ids = arg('ids')!.split(','); cases = cases.filter(c => ids.includes(c.id)); }
if (arg('tags')) { const tags = arg('tags')!.split(','); cases = cases.filter(c => c.tags.some(t => tags.includes(t))); }

/** A budget store that never touches the real one - for the simulated-failure modes. */
const memoryStore: UsageStore = { reserve: async () => ({ ok: true }), adjust: async () => {}, read: async () => ({ requests: 0, tokens: 0 }) };
const failingFetch: typeof fetch = async () => { throw new Error('simulated network failure'); };
const invalidFetch: typeof fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: '{"facts": "not an array", "assessment": {"riskLevel": "Critical"}}' } }], usage: { total_tokens: 100 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function todayTokens() {
  const row = await prisma.aiUsage.findUnique({ where: { bucket: `day:${dayKey(Date.now())}` } });
  return row?.tokens ?? 0;
}

async function main() {
  const cfg = aiConfig();
  if ((mode === 'ai') && !cfg.enabled) throw new Error(`AI mode needs the Groq reader on: ${cfg.offReason}`);
  // Live: the background re-read's wait, so a long report read in stages can
  // finish - what the case ends up with, not only what was ready at filing.
  const deps: ReadDeps | undefined = mode === 'ai-down' ? { fetch: failingFetch, store: memoryStore }
    : mode === 'ai-invalid' ? { fetch: invalidFetch, store: memoryStore }
      : mode === 'ai' ? { maxWaitMs: RETRY_MAX_WAIT_MS } : undefined;
  const useAi = mode !== 'rules';
  const started = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  let stoppedForBudget = false;

  // --merge a.json,b.json: combine runs of the same mode made on different
  // days (the free plan's daily quota cannot fit a full live run plus the
  // fixes before it). The later file wins for a case scored in both.
  const mergeFiles = arg('merge')?.split(',') ?? [];
  if (mergeFiles.length) {
    const byId = new Map<string, unknown>();
    for (const f of mergeFiles) {
      const data = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')) as { meta: { mode: string }; rows: { id: string; skipped?: string }[] };
      if (data.meta.mode !== mode) throw new Error(`${f} is a ${data.meta.mode} run, not ${mode}`);
      for (const r of data.rows) if (!r.skipped) byId.set(r.id, r);
    }
    for (const c of cases) rows.push(byId.get(c.id) ?? { id: c.id, tags: c.tags, skipped: 'not in any merged run' });
  }

  for (const [i, c] of (mergeFiles.length ? [] : cases).entries()) {
    if (mode === 'ai' && !stoppedForBudget && (await todayTokens()) > cfg.dailyTokens - reserve) stoppedForBudget = true;
    if (stoppedForBudget) { rows.push({ id: c.id, tags: c.tags, skipped: 'budget' as const }); console.log(`${c.id}: skipped (daily budget reserve)`); continue; }
    const t0 = Date.now();
    const read = () => runIntake({
      residentId: `eval:${c.id}`, narrative: c.narrative, answers: c.answers, selectedCategory: null, street: null, gender: null,
      useAi, residentNames: [], relationship: c.relationship, turns: [],
    }, undefined, deps);
    let analysis = await read();
    // The provider's per-minute cap is a property of the free plan, not of the
    // reading: wait it out and read the case again (twice at most), as the
    // background retry would. Each wait is reported; a case still refused is
    // scored as it came out.
    for (let attempt = 1; mode === 'ai' && attempt <= 2 && ['rate_limited', 'busy'].includes(analysis.grounding.ai?.status ?? ''); attempt++) {
      console.log(`   ${c.id}: provider said ${analysis.grounding.ai?.status}; waiting 65 s (attempt ${attempt})`);
      await sleep(65_000);
      analysis = await read();
    }
    const rec = await deskFor(analysis, c.narrative, useAi);
    const ms = Date.now() - t0;
    const r = analysis.result;
    const ai = analysis.grounding.ai;
    const a = ai?.assessment ?? null;
    const triage = triageStatusFor(r, a, analysis.grounding.knowledgeBaseStatus === 'unavailable');
    const desk: Desk = rec.decision === 'HUMAN_REVIEW' ? 'NEEDS_OFFICER_REVIEW' : rec.decision;
    const predicted = {
      desk, filingDesk: rec.desk, awaitingAi: rec.awaitingAi,
      caseType: r.suggestedCaseCategory, framework: r.framework, level: r.matrixLevel, label: r.matrixLabel,
      urgent: triage === 'URGENT_REVIEW', triage, assessmentStatus: r.assessmentStatus,
      needsClarification: rec.decision === 'NEEDS_CLARIFICATION' || (r.matrixLevel === null && r.assessmentStatus === 'NEEDS_MORE_INFORMATION'),
      criteria: r.matchedCriteria.filter(m => m.level === r.matrixLevel).map(m => m.indicator),
      facts: analysis.facts,
      ai: ai ? { status: ai.status, used: ai.used, model: ai.model, tokens: ai.tokens, category: ai.hints?.category ?? null,
        stages: (ai as { stages?: number }).stages ?? 1,
        assessment: a ? { status: a.status, framework: a.framework, level: a.level, criteria: a.criteria.map(x => `L${x.level} ${x.criterion}`),
          dropped: a.droppedCriteria, droppedDetail: (a as { droppedDetail?: string[] }).droppedDetail ?? [], sufficient: a.informationSufficient,
          urgent: a.urgentHumanReview, unavailableReason: a.unavailableReason } : null } : null,
      references: analysis.grounding.references.map(x => `${x.riskLevel ?? '-'}:${x.sectionTitle.slice(0, 40)}`),
      sourceVerified: analysis.grounding.sourceVerified,
      ms,
    };
    const e = c.expected;
    const score = {
      deskStrict: desk === e.desk,
      deskAccepted: desk === e.desk || (e.acceptableDesks ?? []).includes(desk),
      caseType: e.caseTypes.includes(r.suggestedCaseCategory),
      level: levelAgreement(e.level, e.acceptableLevels ?? [], r.matrixLevel),
      urgent: predicted.urgent === e.urgent,
      clarification: e.needsClarification === null ? null : predicted.needsClarification === e.needsClarification,
    };
    rows.push({ id: c.id, tags: c.tags, chars: c.narrative.length, apiWouldReject: c.narrative.length > NARRATIVE_MAX, expected: e, predicted, score });
    console.log(`${String(i + 1).padStart(2)}/${cases.length} ${c.id}: desk ${desk}${score.deskAccepted ? '' : ' ✗'} | type ${r.suggestedCaseCategory}${score.caseType ? '' : ' ✗'}`
      + ` | level ${levelLabel(r.matrixLevel)} (${score.level}) | urgent ${predicted.urgent}${score.urgent ? '' : ' ✗'}`
      + (ai ? ` | ai ${ai.status}${a ? `/${a.status}${a.level ? ` L${a.level}` : ''}` : ''} ${ai.tokens}t` : '') + ` | ${ms}ms`);
    // Keep under the free plan's per-minute token cap between live calls. A
    // failed call still used the provider's minute, so it waits too.
    if (mode === 'ai' && ai) await sleep(Math.ceil((Math.max(ai.tokens, 5000) / 7000) * 60_000));
  }

  // ── Scoring ──
  type Scored = { id: string; tags: string[]; chars: number; apiWouldReject: boolean; expected: EvalCase['expected']; predicted: { desk: Desk; caseType: string; level: number | null; urgent: boolean; needsClarification: boolean; ai: { status: string; used: boolean; tokens: number } | null }; score: { deskStrict: boolean; deskAccepted: boolean; caseType: boolean; level: string; urgent: boolean; clarification: boolean | null } };
  const done = rows.filter(x => !x.skipped) as unknown as Scored[];
  const summarise = (set: Scored[]) => {
    const n = set.length || 1;
    const pct = (k: number) => `${k}/${set.length} (${Math.round((k / n) * 100)}%)`;
    const lv = (k: string) => set.filter(x => x.score.level === k).length;
    const falseHigh = set.filter(x => (x.predicted.level ?? 0) >= 4 && !((x.expected.level ?? 0) >= 4) && !(x.expected.acceptableLevels ?? []).some(l => (l ?? 0) >= 4));
    const missedHighLevel = set.filter(x => (x.expected.level ?? 0) >= 4 && (x.predicted.level ?? 0) < 4 && !(x.expected.acceptableLevels ?? []).includes(x.predicted.level));
    const missedUrgent = set.filter(x => x.expected.urgent && !x.predicted.urgent);
    const falseUrgent = set.filter(x => !x.expected.urgent && x.predicted.urgent);
    const clar = set.filter(x => x.score.clarification !== null);
    return {
      cases: set.length,
      deskStrict: pct(set.filter(x => x.score.deskStrict).length),
      deskAccepted: pct(set.filter(x => x.score.deskAccepted).length),
      caseType: pct(set.filter(x => x.score.caseType).length),
      levelExact: pct(lv('exact')), levelAccepted: pct(lv('exact') + lv('accepted')), levelAdjacent: lv('adjacent'), levelWrong: lv('wrong'),
      falseHighRisk: falseHigh.map(x => x.id), missedHighLevel: missedHighLevel.map(x => x.id),
      missedUrgent: missedUrgent.map(x => x.id), falseUrgent: falseUrgent.map(x => x.id),
      urgentRecall: `${set.filter(x => x.expected.urgent && x.predicted.urgent).length}/${set.filter(x => x.expected.urgent).length}`,
      clarification: pct(clar.filter(x => x.score.clarification).length).replace(`/${set.length}`, `/${clar.length}`),
      aiUsed: set.filter(x => x.predicted.ai?.used).length,
      aiStatuses: Object.entries(set.reduce<Record<string, number>>((m, x) => { const s = x.predicted.ai?.status ?? 'not asked'; m[s] = (m[s] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(', '),
      apiWouldReject: set.filter(x => x.apiWouldReject).map(x => x.id),
    };
  };
  const all = summarise(done);
  const long = summarise(done.filter(x => x.tags.includes('long')));
  const deskC = confusion(done.map(x => ({ expected: x.expected.desk, predicted: x.score.deskAccepted ? x.expected.desk : x.predicted.desk })),
    ['BLOTTER', 'VAWC', 'NEEDS_CLARIFICATION', 'NEEDS_OFFICER_REVIEW']);
  const deskStrictC = confusion(done.map(x => ({ expected: x.expected.desk, predicted: x.predicted.desk })), ['BLOTTER', 'VAWC', 'NEEDS_CLARIFICATION', 'NEEDS_OFFICER_REVIEW']);
  const levelC = confusion(done.map(x => ({ expected: levelLabel(x.expected.level), predicted: levelLabel(x.predicted.level) })), LEVEL_ORDER);
  const typeC = confusion(done.map(x => ({ expected: x.expected.caseTypes[0], predicted: x.score.caseType ? x.expected.caseTypes[0] : x.predicted.caseType })));
  const urgentC = confusion(done.map(x => ({ expected: x.expected.urgent ? 'urgent' : 'not urgent', predicted: x.predicted.urgent ? 'urgent' : 'not urgent' })), ['urgent', 'not urgent']);

  const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(root, 'tests/eval/results');
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${stamp}-${mode}${label ? `-${label}` : ''}`);
  const meta = { mode, label, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), model: useAi ? cfg.model : null,
    datasetVersion: dataset.version, reviewStatus: dataset.reviewStatus, filter: { ids: arg('ids') ?? null, tags: arg('tags') ?? null },
    mergedFrom: mergeFiles.map(f => path.basename(f)),
    skippedForBudget: rows.filter(x => x.skipped).map(x => x.id) };
  fs.writeFileSync(`${base}.json`, JSON.stringify({ meta, summary: { all, long }, confusion: { desk: deskC, deskStrict: deskStrictC, level: levelC, caseType: typeC, urgent: urgentC }, rows }, null, 2));

  const yes = (b: boolean | null) => (b === null ? '–' : b ? '✓' : '✗');
  const md = [
    `# Classification evaluation - ${mode}${label ? ` (${label})` : ''}`, '',
    `Run ${meta.startedAt}${mergeFiles.length ? ` (merged from ${meta.mergedFrom.join(", ")})` : ""} · dataset v${dataset.version}, ${done.length} cases scored${meta.skippedForBudget.length ? `, ${meta.skippedForBudget.length} skipped to protect the daily AI budget` : ''}` + (useAi ? ` · model ${cfg.model}` : ''), '',
    `> ${dataset.reviewStatus}`, '',
    '## Summary', '',
    '| measure | all cases | long narratives |', '|---|---|---|',
    ...([['Desk (exact)', 'deskStrict'], ['Desk (exact or accepted alternative)', 'deskAccepted'], ['Case type', 'caseType'], ['Risk level exact', 'levelExact'],
      ['Risk level exact or accepted', 'levelAccepted'], ['Risk level off by one', 'levelAdjacent'], ['Risk level otherwise wrong', 'levelWrong'],
      ['Urgent cases flagged (recall)', 'urgentRecall'], ['Clarification decision', 'clarification'], ['AI reading used', 'aiUsed'], ['AI status', 'aiStatuses']] as const)
      .map(([name, k]) => `| ${name} | ${all[k]} | ${long[k]} |`),
    `| False high risk (predicted Level 4-5, expected lower or none) | ${all.falseHighRisk.length} ${all.falseHighRisk.join(', ')} | ${long.falseHighRisk.length} |`,
    `| Missed high level (expected Level 4-5, predicted lower or none) | ${all.missedHighLevel.length} ${all.missedHighLevel.join(', ')} | ${long.missedHighLevel.length} |`,
    `| Missed urgent | ${all.missedUrgent.length} ${all.missedUrgent.join(', ')} | ${long.missedUrgent.length} |`,
    `| Flagged urgent but not expected | ${all.falseUrgent.length} ${all.falseUrgent.join(', ')} | ${long.falseUrgent.length} |`,
    `| Narratives the filing API would refuse as too long (> ${NARRATIVE_MAX} chars) | ${all.apiWouldReject.join(', ') || 'none'} | |`,
    '', '## Confusion matrices', '',
    confusionTable(deskC, 'Desk (an accepted alternative counts as the expected desk)'),
    confusionTable(deskStrictC, 'Desk (exact)'),
    confusionTable(levelC, 'Risk level (none = undetermined)'),
    confusionTable(urgentC, 'Urgent flag'),
    confusionTable(typeC, 'Case type (any listed type counts as the first)'),
    '## Per case', '',
    '| case | chars | desk exp → got | type exp → got | level exp → got | urgent exp → got | clarify exp → got | AI |',
    '|---|---:|---|---|---|---|---|---|',
    ...done.map(x => `| ${x.id} | ${x.chars} | ${x.expected.desk} → ${x.predicted.desk} ${yes(x.score.deskAccepted)} | ${x.expected.caseTypes[0]} → ${x.predicted.caseType} ${yes(x.score.caseType)}`
      + ` | ${levelLabel(x.expected.level)} → ${levelLabel(x.predicted.level)} ${x.score.level === 'exact' || x.score.level === 'accepted' ? '✓' : `✗ ${x.score.level}`}`
      + ` | ${x.expected.urgent} → ${x.predicted.urgent} ${yes(x.score.urgent)} | ${x.expected.needsClarification ?? '–'} → ${x.predicted.needsClarification} ${yes(x.score.clarification)}`
      + ` | ${x.predicted.ai ? `${x.predicted.ai.status}${x.predicted.ai.used ? '' : ' (not used)'}` : 'not asked'} |`),
    '',
  ].join('\n');
  fs.writeFileSync(`${base}.md`, md);
  console.log(`\nDesk ${all.deskAccepted} (exact ${all.deskStrict}) · type ${all.caseType} · level ${all.levelAccepted} (exact ${all.levelExact})`
    + ` · urgent recall ${all.urgentRecall} · false high ${all.falseHighRisk.length} · missed high ${all.missedHighLevel.length} · missed urgent ${all.missedUrgent.length}`);
  console.log(`Written ${path.relative(root, base)}.md / .json`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
