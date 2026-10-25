/**
 * The two risk classification matrices SafeComm assesses against.
 *
 *   BLOTTER - "Barangay Blotter Matrix" (knowledge/sources/blotter-risk-matrix.pdf)
 *   VAWC    - "Proposed Incident Risk Classification Matrix"
 *             (knowledge/sources/vawc-risk-matrix.pdf)
 *
 * The level labels and every indicator below are the documents' own words,
 * taken from their "Examples / Indicators" column and split at the semicolons
 * (VAWC level 5 at its commas). tests/riskMatrices.test.ts checks each one
 * against the text extracted from the PDFs, so these rules cannot drift from
 * the source. What is ours is only the `when` beside each indicator: which
 * facts stated in a report satisfy it. Where nothing in a report could ever
 * show an indicator ("minor policy violation", "severe criminal violations"),
 * it has no rule and is left to an officer.
 *
 * Both are operational triage frameworks, not law. The VAWC document says in
 * terms that its five levels are "a proposed operational risk-stratification
 * framework ... not an official five-level classification prescribed by
 * Philippine law"; the Blotter document that its levels "do not establish
 * legal guilt". Neither decides whether an offence occurred.
 */

export type Framework = 'BLOTTER' | 'VAWC';

/** Facts read from a report. `true` or the resident's own words for it. */
export type Facts = Map<string, string | true>;

/** Satisfied when every `all`, at least one `any` (if given), and no `none` holds. */
export interface Cond { all?: string[]; any?: string[]; none?: string[] }

export interface Indicator {
  /**
   * How SafeComm reads this indicator where the document leaves room, and
   * what it has asked the matrix owners to clarify. Shown to officers. Never
   * a change to the document's wording.
   */
  note?: string;
  /** Exactly as the document writes it. */
  text: string;
  /** Null: no report fact can show this; an officer decides. */
  when: Cond | null;
}

export interface MatrixLevel {
  level: 1 | 2 | 3 | 4 | 5;
  /** Exactly as the document's Risk Classification column gives it. */
  label: string;
  indicators: Indicator[];
}

export interface MatrixDefinition {
  framework: Framework;
  documentName: string;
  sourceFile: string;
  status: string;
  levels: MatrixLevel[];
}

/**
 * VAWC Level 4 lists "Physical assault" under the heading "CRITICAL –
 * Violence Occurring / Imminent", without distinguishing severity. SafeComm
 * applies it when the violence is happening now or is about to - what the
 * heading says - and does not stretch it to an assault that has ended. The
 * document does not say how an ended assault should be classified; that is
 * left undetermined, sent for officer review, and raised with the matrix
 * owners (knowledge/MATRIX_REVIEW.md). The wording of the document is
 * unchanged.
 */
export const PHYSICAL_ASSAULT_NOTE =
  'Applied when the violence is occurring or imminent, per this level\'s heading "Violence Occurring / Imminent". '
  + 'The matrix does not say how to classify a physical assault that has ended; such reports are left undetermined for officer review. '
  + 'Clarification requested from the matrix owners.';

export const VAWC_MATRIX: MatrixDefinition = {
  framework: 'VAWC',
  documentName: 'Proposed Incident Risk Classification Matrix',
  sourceFile: 'knowledge/sources/vawc-risk-matrix.pdf',
  status: 'Proposed operational risk-stratification framework — not an official five-level classification prescribed by Philippine law, the DILG, PCW, PNP, or DSWD.',
  levels: [
    { level: 1, label: 'LOW – Minor Incident', indicators: [
      { text: 'Verbal disagreement', when: { all: ['quarrel'], none: ['force', 'threat'] } },
      // "Isolated" is read from what was said (it happened once), not from
      // silence: an unknown history is not an isolated one.
      { text: 'isolated rude behavior', when: { all: ['rude', 'firstTime'], none: ['repeated', 'force', 'threat'] } },
      { text: 'minor non-threatening conflict', when: { all: ['quarrel', 'harmDenied'], none: ['threat'] } },
      { text: 'minor policy violation', when: null },
    ] },
    { level: 2, label: 'MODERATE – Concerning Behavior', indicators: [
      { text: 'Repeated unwanted messages', when: { any: ['messages'] } },
      { text: 'bullying/intimidation', when: { any: ['bullying', 'intimidation'] } },
      { text: 'stalking-like conduct', when: { any: ['stalking'] } },
      { text: 'sexual remarks', when: { all: ['harassment'], none: ['seriousHarassment'] } },
      { text: 'escalating relationship/domestic dispute', when: { all: ['quarrel', 'household', 'repeatedOrWorse'] } },
      { text: 'non-imminent threats', when: { all: ['threat'], none: ['imminent', 'explicitThreat'] } },
    ] },
    { level: 3, label: 'HIGH – Threat of Harm', indicators: [
      { text: 'Explicit threat to hurt someone', when: { any: ['explicitThreat'] } },
      { text: 'repeated stalking with threats', when: { all: ['stalking', 'threat'] } },
      { text: 'escalating intimate-partner violence', when: { all: ['partner', 'repeatedOrWorse'], any: ['force', 'threat'] } },
      { text: 'coercive control', when: { any: ['coercive'] } },
      { text: 'serious sexual harassment', when: { any: ['seriousHarassment'] } },
      { text: 'credible weapon-related threat', when: { all: ['weaponShown', 'threat'] } },
    ] },
    { level: 4, label: 'CRITICAL – Violence Occurring / Imminent', indicators: [
      // Read within its level's own heading, "Violence Occurring / Imminent"
      // (Suggested Action: "Treat as an emergency"). It used to fire on any
      // physical contact at any time - so a single past push was Critical.
      { text: 'Physical assault', when: { all: ['force', 'imminent'] }, note: PHYSICAL_ASSAULT_NOTE },
      { text: 'strangulation/choking', when: { any: ['choking'] } },
      { text: 'weapon displayed', when: { any: ['weaponShown'] } },
      { text: 'forced confinement', when: { any: ['confinement'] } },
      { text: 'severe beating', when: { any: ['severeBeating'] } },
      { text: 'sexual assault', when: { any: ['sexualViolence'] } },
      { text: 'active pursuit of a victim', when: { any: ['pursuit'] } },
      { text: 'credible imminent threat to kill', when: { all: ['killThreat', 'imminent'] } },
    ] },
    { level: 5, label: 'EXTREME – Life-Threatening / Catastrophic', indicators: [
      { text: 'Shooting', when: { any: ['shooting'] } },
      { text: 'stabbing', when: { any: ['stabbing'] } },
      { text: 'hostage situation', when: { any: ['hostage'] } },
      { text: 'armed attack', when: { all: ['weaponUsed', 'force'] } },
      { text: 'severe violence causing unconsciousness', when: { any: ['unconscious'] } },
      { text: 'suspected attempted killing', when: { any: ['attemptedKilling'] } },
      { text: 'death', when: { any: ['death'] } },
      { text: 'multiple casualties', when: { any: ['casualties'] } },
    ] },
  ],
};

export const BLOTTER_MATRIX: MatrixDefinition = {
  framework: 'BLOTTER',
  documentName: 'Barangay Blotter Matrix',
  sourceFile: 'knowledge/sources/blotter-risk-matrix.pdf',
  status: 'Operational intake and triage framework — levels reflect reported factual circumstances and potential community risk; they do not establish legal guilt.',
  levels: [
    { level: 1, label: 'LOW — Minor Community Disturbance', indicators: [
      { text: 'Curfew noise violations', when: { all: ['noise'], none: ['repeated'] } },
      { text: 'minor boundary disagreements', when: { all: ['boundary'], none: ['landDispute'] } },
      { text: 'isolated pet nuisances', when: { all: ['pets', 'firstTime'], none: ['repeated'] } },
      { text: 'non-threatening verbal misunderstandings', when: { all: ['quarrel'], none: ['threat', 'force'] } },
      { text: 'minor sanitation issues', when: { all: ['sanitation'], none: ['repeated'] } },
    ] },
    { level: 2, label: 'MODERATE — Recurring Dispute or Financial Conflict', indicators: [
      { text: 'Unpaid small monetary debts', when: { any: ['debt'] } },
      { text: 'property line disputes', when: { any: ['landDispute'] } },
      { text: 'minor accidental property damage', when: { any: ['accidentalDamage'] } },
      { text: 'repeated nuisance behavior', when: { all: ['repeated'], any: ['noise', 'nuisance', 'pets', 'sanitation'] } },
      { text: 'tenant-landlord conflicts', when: { any: ['tenant'] } },
    ] },
    { level: 3, label: 'HIGH — Serious Non-Domestic Dispute', indicators: [
      { text: 'Credible verbal threats', when: { all: ['threat'], none: ['weaponShown'] } },
      { text: 'persistent intimidation or slander', when: { any: ['slander', 'persistentIntimidation'] } },
      { text: 'escalating confrontation in public', when: { all: ['quarrel', 'publicPlace', 'repeatedOrWorse'] } },
      { text: 'minor physical altercations without severe injury',
        when: { all: ['force'], none: ['injurySerious', 'injuryTreatment', 'severeBeating', 'choking'] } },
    ] },
    { level: 4, label: 'CRITICAL — Imminent Violent Threat or Crime', indicators: [
      { text: 'Serious physical assault', when: { all: ['force'], any: ['injurySerious', 'injuryTreatment', 'severeBeating', 'choking'] } },
      { text: 'weapon-related threats', when: { all: ['weaponShown'], any: ['threat', 'force'] } },
      { text: 'ongoing violent altercations in public spaces', when: { all: ['force', 'imminent', 'publicPlace'] } },
      { text: 'theft or robbery', when: { any: ['theft'] } },
      { text: 'severe criminal violations', when: null },
    ] },
    { level: 5, label: 'EXTREME — Catastrophic / Armed Incident', indicators: [
      { text: 'Active armed attack', when: { all: ['weaponUsed'], any: ['force', 'imminent'] } },
      { text: 'shooting or stabbing incidents', when: { any: ['shooting', 'stabbing'] } },
      { text: 'hostage situations', when: { any: ['hostage'] } },
      { text: 'attempted homicides', when: { any: ['attemptedKilling'] } },
      { text: 'events presenting immediate threat to life', when: { all: ['imminent'], any: ['killThreat', 'weaponShown', 'death', 'casualties'] } },
    ] },
  ],
};

export const MATRICES: Record<Framework, MatrixDefinition> = { BLOTTER: BLOTTER_MATRIX, VAWC: VAWC_MATRIX };

export function condHolds(c: Cond, facts: Facts): boolean {
  if (c.all && !c.all.every(k => facts.has(k))) return false;
  if (c.any && c.any.length && !c.any.some(k => facts.has(k))) return false;
  if (c.none && c.none.some(k => facts.has(k))) return false;
  return Boolean(c.all?.length || c.any?.length);
}

export interface MatchedIndicator {
  level: number;
  levelLabel: string;
  indicator: string;
  /** The resident's own words behind it, where there are any. */
  evidence: string[];
}

export interface MatrixEvaluation {
  framework: Framework;
  documentName: string;
  status: string;
  /** Null when no indicator in the matrix is met by what was reported. */
  level: number | null;
  label: string | null;
  /** Every indicator met, highest level first. */
  matched: MatchedIndicator[];
}

/** Applies a matrix to the facts. The highest level with a met indicator is the level. */
export function evaluateMatrix(framework: Framework, facts: Facts): MatrixEvaluation {
  const m = MATRICES[framework];
  const matched: MatchedIndicator[] = [];
  for (const lv of [...m.levels].sort((a, b) => b.level - a.level)) {
    for (const ind of lv.indicators) {
      if (!ind.when || !condHolds(ind.when, facts)) continue;
      const keys = [...(ind.when.all ?? []), ...(ind.when.any ?? []).filter(k => facts.has(k))];
      const evidence = [...new Set(keys.map(k => facts.get(k)).filter((q): q is string => typeof q === 'string'))];
      matched.push({ level: lv.level, levelLabel: lv.label, indicator: ind.text, evidence });
    }
  }
  const top = matched[0];
  return {
    framework, documentName: m.documentName, status: m.status,
    level: top ? top.level : null,
    label: top ? top.levelLabel : null,
    matched,
  };
}

/**
 * The 5-level matrix result as the 4-value riskLevel the rest of SafeComm
 * queues and filters by. Extreme and Critical both sort as Critical; the
 * matrix's own label is stored and shown beside it.
 */
export function queueLevelFor(level: number): 'Low' | 'Medium' | 'High' | 'Critical' {
  return level >= 4 ? 'Critical' : level === 3 ? 'High' : level === 2 ? 'Medium' : 'Low';
}

/**
 * English phrases from the matrices for each fact, so a Tagalog report can be
 * searched against English source text. pg_trgm compares letters, not
 * meaning: "sinuntok" shares no trigrams with "physical assault".
 */
export const MATRIX_VOCABULARY: Record<string, string[]> = {
  force: ['physical assault', 'physical altercations'],
  choking: ['strangulation/choking'],
  severeBeating: ['severe beating'],
  threat: ['threats', 'verbal threats'],
  explicitThreat: ['explicit threat to hurt someone'],
  killThreat: ['threat to kill'],
  weaponShown: ['weapon displayed', 'weapon-related threats'],
  weaponUsed: ['armed attack'],
  shooting: ['shooting'], stabbing: ['stabbing'],
  hostage: ['hostage situation'],
  confinement: ['forced confinement'],
  pursuit: ['active pursuit of a victim'],
  sexualViolence: ['sexual assault'],
  harassment: ['sexual remarks'], seriousHarassment: ['serious sexual harassment'],
  stalking: ['stalking-like conduct'],
  messages: ['repeated unwanted messages'],
  bullying: ['bullying/intimidation'], intimidation: ['intimidation'],
  coercive: ['coercive control'],
  quarrel: ['verbal disagreement', 'verbal misunderstandings'],
  rude: ['rude behavior'],
  noise: ['curfew noise violations'], boundary: ['boundary disagreements'],
  landDispute: ['property line disputes'], pets: ['pet nuisances'],
  sanitation: ['sanitation issues'], debt: ['unpaid small monetary debts'],
  tenant: ['tenant-landlord conflicts'], theft: ['theft or robbery'],
  slander: ['intimidation or slander'], accidentalDamage: ['accidental property damage'],
  unconscious: ['severe violence causing unconsciousness'],
  attemptedKilling: ['attempted killing', 'attempted homicides'],
  death: ['death'], casualties: ['multiple casualties'],
};
