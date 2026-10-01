import {
  higherLevel, levelForScore, minScoreForLevel, reconcileScore,
  stripLevelWords, type RiskLevelName,
} from './riskLevel';

/**
 * Initial case classification: a category, fourteen grounded parameters,
 * routing hints, and a level the hard rules enforce.
 *
 * Two things shape the design.
 *
 * Nothing is asserted without a quote. Every parameter that is not "unknown"
 * carries the words from the report that produced it, so an officer can see
 * what the classification rests on and a wrong one can be traced rather than
 * argued with. A parameter with no supporting words stays "unknown", and an
 * unknown never lowers the level - it is added to missing_information instead.
 *
 * The hard rules run in code, not in a prompt. A model may fill these
 * parameters one day, but H1-H7 are enforced here afterwards either way: a
 * rule that only exists as an instruction is a rule that holds until the model
 * has an off day, and these decide whether a child in danger is seen tonight.
 *
 * This is an initial indicator. It does not determine fault, gives no legal
 * advice, and never claims the PNP was contacted.
 */

export const CASE_CATEGORIES = [
  'neighbor_community_dispute', 'physical_harm', 'domestic_family', 'property',
  'traffic_accident', 'public_safety', 'gender_based_harassment', 'child_related',
  'other_unclear',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export type YesNoUnknown = 'yes' | 'no' | 'unknown';

export interface Parameters {
  vulnerable_person: ('none' | 'minor' | 'elderly' | 'pwd' | 'pregnant' | 'unknown')[];
  immediate_danger: YesNoUnknown;
  weapon: 'none' | 'present' | 'used' | 'unknown';
  injury: 'none' | 'minor' | 'needs_treatment' | 'serious' | 'unknown';
  relationship: 'strangers' | 'neighbors' | 'family' | 'intimate_partners' | 'unknown';
  frequency: 'one_time' | 'repeated' | 'unknown';
  escalation: 'getting_worse' | 'stable' | 'unknown';
  threats: 'none' | 'verbal' | 'explicit' | 'unknown';
  intoxication: YesNoUnknown;
  people_affected: 'one' | 'few' | 'community' | 'unknown';
  property_damage: 'none' | 'minor' | 'major' | 'unknown';
  reporter_safety: 'safe' | 'unsafe' | 'unknown';
  prior_cases: 'none' | 'some' | 'unknown';
  evidence: ('photo' | 'document' | 'witness')[];
}

export interface RoutingHints {
  same_city_or_municipality: YesNoUnknown;
  light_offense_for_mediation: YesNoUnknown;
  government_party: YesNoUnknown;
  partner_or_household_violence: YesNoUnknown;
  child_involved: YesNoUnknown;
  police_referral_suggested: YesNoUnknown;
  disaster_or_hazard: YesNoUnknown;
}

export interface EvidenceQuote { parameter: string; quote: string }

export interface Classification {
  case_category: CaseCategory;
  category_confidence: 'high' | 'medium' | 'low';
  parameters: Parameters;
  evidence_from_report: EvidenceQuote[];
  routing_hints: RoutingHints;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  score: number;
  confidence: number;
  hard_rules_applied: string[];
  detected_risk_factors: string[];
  explanation: string;
  recommended_review: 'Standard Review' | 'Priority Review' | 'Urgent Human Review';
  missing_information: string[];
  needs_human_review: boolean;
  needs_human_review_reason: string;
}

export interface ClassificationInput {
  /** What the resident typed. */
  report: string;
  /** Fields the resident CONFIRMED from a document, never a raw reading. */
  confirmedDocument?: { type?: string; text?: string } | null;
  /** Words a reader was unsure of; these can never support a parameter. */
  unclearWords?: string[];
  /** Earlier cases for the same people or address. */
  priorCases?: number;
  attachments?: { photos?: number; documents?: number };
}

// ─── Matching ────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/** Pronoun-stripped copy, so a Tagalog phrase split by "niya" still matches. */
const compactOf = (s: string) => s.replace(/\b(niya|siya|nya|nila|namin)\b/g, ' ').replace(/\s+/g, ' ');

/**
 * At most 12 words around the match, per the grounding rule, and never past
 * the end of the sentence that carried it. A quote that runs on into the next
 * sentence stops being evidence for the thing it was quoted for - on a police
 * docket it drags a plate number in behind a mention of alcohol.
 */
function quoteAround(original: string, term: string): string {
  const words = original.trim().split(/\s+/);
  const lowered = words.map(w => norm(w));
  const first = norm(term).split(' ')[0];
  const at = lowered.findIndex(w => w.includes(first));
  if (at === -1) return words.slice(0, 12).join(' ');

  // The sentence around the match: back to the last full stop before it,
  // forward to the first one at or after it.
  const ends = (w: string) => /[.!?](["')\]]*)$/.test(w);
  let lo = at;
  while (lo > 0 && !ends(words[lo - 1])) lo--;
  let hi = at;
  while (hi < words.length - 1 && !ends(words[hi])) hi++;

  const start = Math.max(lo, at - 4);
  return words.slice(start, Math.min(hi + 1, start + 12)).join(' ');
}

/**
 * Tagalog affixes a root rather than standing it alone, so a term has to be
 * allowed to carry one: "bata" must still be found in "batang", "sugat" in
 * "nasugatan". What it must NOT do is match a run of letters in the middle of
 * an unrelated word - "ama" sitting inside "alfamart" once made a shoplifting
 * report look like a family case, and "nabali" inside "nabaliw" turned "went
 * crazy" into a broken bone and a Critical level.
 *
 * Only prefixes and suffixes are generalised. Tagalog also INFIXES - "hipo"
 * becomes "hinipo" and then "hinipuan", with the o mutating to u - and no
 * prefix rule reaches that. A verb added here needs its inflected forms
 * listed, not just its root.
 */
const PREFIX = '(?:nag|naka|pinag|ipinag|sina|bina|nang|mag|na|ma|ka|pag|pa|ni|um|in)?';
const SUFFIX = '(?:han|hin|ng|an|in|on|g|n|s)?';
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cached: the same few dozen terms are matched on every report. */
const patterns = new Map<string, RegExp>();
function wordPattern(n: string): RegExp {
  let re = patterns.get(n);
  if (!re) {
    // A phrase is long enough to be safe on its own; a single word is not.
    re = / |-/.test(n)
      ? new RegExp(esc(n))
      : new RegExp(`(?<![a-z0-9])${PREFIX}${esc(n)}${SUFFIX}(?![a-z0-9])`);
    patterns.set(n, re);
  }
  return re;
}

/** The first term that appears, with the words that carried it. */
function find(text: string, original: string, terms: string[], blocked: string[]):
  { term: string; quote: string } | null {
  const t = norm(text);
  const c = compactOf(t);
  for (const term of terms) {
    const n = norm(term);
    const re = wordPattern(n);
    if (!re.test(t) && !re.test(c)) continue;
    // A word the reader was unsure of cannot support a parameter.
    if (blocked.some(b => norm(b) && n.includes(norm(b)))) continue;
    return { term, quote: quoteAround(original, term) };
  }
  return null;
}

// ─── Term tables ─────────────────────────────────────────────────────────────

const T = {
  minor: ['bata', 'anak', 'menor de edad', 'estudyante', 'kapatid na', 'minor', 'child', 'kid', 'teenager'],
  elderly: ['matanda', 'lolo', 'lola', 'senior citizen', 'elderly'],
  pwd: ['may kapansanan', 'pwd', 'disabled', 'bulag', 'pilay'],
  pregnant: ['buntis', 'pregnant', 'nagdadalang-tao'],

  dangerNow: ['nasa labas ngayon', 'nandito pa', 'andito siya ngayon', 'hinahanap ako',
    'kasalukuyang', 'ngayon din', 'right now', 'currently here', 'still here now', 'outside now'],
  weaponUsed: ['sinaksak', 'binaril', 'pinukpok', 'tinaga', 'stabbed', 'shot me', 'hit me with'],
  weaponPresent: ['kutsilyo', 'baril', 'itak', 'armas', 'balisong', 'knife', 'gun', 'bolo', 'weapon'],

  injurySerious: ['malubha', 'nabali', 'nawalan ng malay', 'malubhang sugat', 'serious injury',
    'unconscious', 'broken bone', 'fracture'],
  injuryTreatment: ['dinala sa ospital', 'ospital', 'tinahi', 'nagpagamot', 'hospital', 'stitches', 'treated'],
  injuryMinor: ['sugat', 'pasa', 'galos', 'bruise', 'scratch', 'minor injury'],
  injuryNone: ['walang nasaktan', 'walang nasugatan', 'wala naman nasaktan', 'no one was hurt', 'nobody was hurt'],

  neighbors: ['kapitbahay', 'katabi ng bahay', 'kapit-bahay', 'neighbour', 'neighbor', 'kalapit'],
  family: ['kapatid', 'tatay', 'nanay', 'ama', 'ina', 'tiyo', 'tiya', 'pamilya', 'brother', 'sister', 'father', 'mother'],
  partner: ['asawa', 'partner', 'kinakasama', 'live-in', 'nobyo', 'nobya', 'boyfriend', 'girlfriend', 'husband', 'wife'],
  strangers: ['hindi ko kilala', 'estranghero', 'stranger', 'unknown person'],

  repeated: ['paulit-ulit', 'palagi', 'lagi', 'madalas', 'araw-araw', 'gabi-gabi', 'ilang beses',
    'repeatedly', 'every night', 'every day', 'always', 'again and again'],
  oneTime: ['isang beses lang', 'ngayon lang', 'unang beses', 'first time', 'one time only'],

  worsening: ['lumalala', 'mas malala', 'mas matindi', 'dumadalas', 'getting worse', 'escalating', 'worse now'],
  stable: ['ganun pa rin', 'ganoon pa rin', 'wala pa ring pagbabago', 'same as before', 'no change'],

  threatExplicit: ['papatayin', 'sasaktan', 'kill you', 'kill me', 'bugbugin kita', 'paparusahan'],
  threatVerbal: ['nagbanta', 'binantaan', 'pinagbantaan', 'threatened', 'nananakot', 'tinakot'],
  threatNone: ['walang banta', 'hindi naman nagbanta', 'no threats'],

  intoxicated: ['lasing', 'nakainom', 'nag-inom', 'alak', 'tomador', 'drunk', 'intoxicated', 'alcohol', 'liquor'],
  notIntoxicated: ['hindi lasing', 'walang alak', 'not drunk', 'no alcohol'],

  community: ['buong kalye', 'maraming tao', 'buong barangay', 'mga kapitbahay', 'whole street', 'many residents', 'community'],
  few: ['kami', 'kaming dalawa', 'mag-asawa', 'both of us', 'two of us'],

  damageMajor: ['nasira ang bahay', 'malaking pinsala', 'nasunog', 'major damage', 'destroyed'],
  damageMinor: ['nabasag', 'nasira ang', 'napinsala', 'broke my', 'damaged', 'binasag'],
  damageNone: ['walang nasira', 'walang napinsala', 'nothing was damaged'],

  unsafe: ['takot ako', 'natatakot', 'hindi ako ligtas', 'delikado', 'afraid', 'not safe', 'unsafe', 'scared'],
  safe: ['ligtas naman ako', 'ligtas kami', 'i am safe', 'we are safe'],

  witness: ['nakita ng', 'may saksi', 'testigo', 'witness', 'nakakita'],

  noise: ['ingay', 'videoke', 'karaoke', 'maingay', 'tugtog', 'noise', 'loud music'],
  boundary: ['hangganan', 'bakod', 'lupa', 'boundary', 'fence', 'trespass', 'pumasok sa lupa'],
  pets: ['aso', 'pusa', 'hayop', 'dog', 'cat', 'pet'],
  traffic: ['banggaan', 'nabangga', 'aksidente', 'nagkabanggaan', 'motorsiklo', 'sasakyan',
    'collision', 'accident', 'crashed', 'hit my car', 'motorcycle'],
  // The root rather than one voice of it: the affix rule then reaches
  // ninakaw, nagnakaw, nakawan and nanakaw from the same entry.
  theft: ['nakaw', 'magnanakaw', 'nawala ang', 'holdap', 'nanloob', 'nilooban', 'pinasok ang bahay',
    'stolen', 'stole', 'theft', 'robbery', 'snatched', 'burglary', 'broke into'],
  vandalism: ['vandalism', 'vandal', 'pintura', 'pipintura', 'pinintahan', 'binutas',
    'sinira ang pader', 'graffiti', 'spray paint'],
  hazard: ['sunog', 'baha', 'nasusunog', 'kuryente', 'fire', 'flood', 'hazard', 'leak', 'wire'],
  gambling: ['sugal', 'tupada', 'gambling', 'jueteng'],
  drugs: ['droga', 'shabu', 'drugs', 'nagtutulak'],
  harassment: ['panghihipo', 'hinipuan', 'hinipo', 'hinihipo', 'hipuan', 'bastos',
    'cat call', 'catcall', 'harassment', 'tinitigan nang masama', 'nambabastos'],
  // Reported rape was reaching this file as "other_unclear" and scoring Low,
  // because none of these words were in it.
  sexualViolence: ['gahasa', 'ginahasa', 'nagahasa', 'panggagahasa', 'hinalay', 'halay',
    'pinagsamantalahan', 'rape', 'raped', 'sexual assault', 'molested', 'molestation'],
  stalking: ['sinusundan', 'sumusunod sakin', 'sumusunod sa akin', 'sinusundan ako',
    'stalker', 'stalking', 'followed me', 'following me'],
  bullying: ['bullying', 'binu-bully', 'inaapi sa eskwelahan'],
  missingChild: ['nawawalang bata', 'missing child', 'hindi makita ang anak'],
  // Force already applied to a person. Kept in step with the analyser's own
  // vocabulary so the two modules cannot disagree about the same sentence.
  // Never the bare 'saktan': it matches inside 'sasaktan kita', which is a
  // threat of harm rather than harm that happened.
  physical: [
    'sinuntok', 'sinampal', 'sinipa', 'sinaktan', 'sinasaktan', 'pananakit', 'nanakit',
    'binugbog', 'bugbog', 'sinakal', 'sinabunutan', 'hinampas', 'tinulak', 'kinaladkad',
    'away', 'suntukan', 'sapakan', 'nag-away',
    'punched', 'slapped', 'kicked', 'beaten', 'choked', 'hit me', 'hurt me', 'struck me',
    'fistfight', 'mauled', 'assaulted',
  ],
  domestic: ['asawa ko', 'kinakasama ko', 'sa loob ng bahay namin', 'domestic', 'household violence'],
  govt: ['barangay official', 'kagawad', 'kapitan', 'opisyal ng barangay', 'government office', 'city hall'],
};

// ─── Classification ──────────────────────────────────────────────────────────

interface Ctx { text: string; original: string; blocked: string[]; quotes: EvidenceQuote[] }

function set<V extends string>(ctx: Ctx, param: string, terms: string[], value: V): V | null {
  const hit = find(ctx.text, ctx.original, terms, ctx.blocked);
  if (!hit) return null;
  ctx.quotes.push({ parameter: param, quote: hit.quote });
  return value;
}

function pickCategory(ctx: Ctx): { category: CaseCategory; confidence: 'high' | 'medium' | 'low' } {
  const has = (terms: string[]) => Boolean(find(ctx.text, ctx.original, terms, ctx.blocked));

  // Ordered by the level they would carry, so a report that fits two is placed
  // in the more serious one, as the specification requires.
  // First, because it is the most serious thing this file can be asked to
  // place, and because a report of it must never fall through to "unclear".
  if (has(T.sexualViolence)) return { category: 'gender_based_harassment', confidence: 'high' };
  if (has(T.domestic) || (has(T.partner) && has(T.physical))) return { category: 'domestic_family', confidence: 'high' };
  if (has(T.missingChild) || has(T.bullying)) return { category: 'child_related', confidence: 'high' };
  if (has(T.physical) || has(T.weaponPresent) || has(T.threatExplicit)) return { category: 'physical_harm', confidence: 'high' };
  if (has(T.harassment) || has(T.stalking)) return { category: 'gender_based_harassment', confidence: 'medium' };
  if (has(T.traffic)) return { category: 'traffic_accident', confidence: 'high' };
  if (has(T.hazard) || has(T.gambling) || has(T.drugs)) return { category: 'public_safety', confidence: 'medium' };
  if (has(T.theft) || has(T.vandalism)) return { category: 'property', confidence: 'high' };
  if (has(T.noise) || has(T.boundary) || has(T.pets)) return { category: 'neighbor_community_dispute', confidence: 'high' };
  return { category: 'other_unclear', confidence: 'low' };
}

export function classifyCase(input: ClassificationInput): Classification {
  const confirmed = input.confirmedDocument?.text ?? '';
  const original = [input.report, confirmed].filter(Boolean).join('\n');
  const ctx: Ctx = {
    text: original,
    original,
    blocked: input.unclearWords ?? [],
    quotes: [],
  };

  const { category, confidence: category_confidence } = pickCategory(ctx);

  // ── Parameters. Absent evidence means "unknown", never a reassuring value. ──
  const vulnerable: Parameters['vulnerable_person'] = [];
  for (const [terms, value] of [
    [T.minor, 'minor'], [T.elderly, 'elderly'], [T.pwd, 'pwd'], [T.pregnant, 'pregnant'],
  ] as const) {
    const v = set(ctx, 'vulnerable_person', [...terms], value);
    if (v) vulnerable.push(v);
  }

  const weapon =
    set(ctx, 'weapon', T.weaponUsed, 'used' as const)
    ?? set(ctx, 'weapon', T.weaponPresent, 'present' as const)
    ?? 'unknown';

  const injury =
    set(ctx, 'injury', T.injurySerious, 'serious' as const)
    ?? set(ctx, 'injury', T.injuryTreatment, 'needs_treatment' as const)
    ?? set(ctx, 'injury', T.injuryNone, 'none' as const)
    ?? set(ctx, 'injury', T.injuryMinor, 'minor' as const)
    ?? 'unknown';

  const threats =
    set(ctx, 'threats', T.threatExplicit, 'explicit' as const)
    ?? set(ctx, 'threats', T.threatNone, 'none' as const)
    ?? set(ctx, 'threats', T.threatVerbal, 'verbal' as const)
    ?? 'unknown';

  const parameters: Parameters = {
    vulnerable_person: vulnerable.length ? vulnerable : ['unknown'],
    immediate_danger: set(ctx, 'immediate_danger', T.dangerNow, 'yes' as const) ?? 'unknown',
    weapon,
    injury,
    relationship:
      set(ctx, 'relationship', T.partner, 'intimate_partners' as const)
      ?? set(ctx, 'relationship', T.family, 'family' as const)
      ?? set(ctx, 'relationship', T.neighbors, 'neighbors' as const)
      ?? set(ctx, 'relationship', T.strangers, 'strangers' as const)
      ?? 'unknown',
    frequency:
      set(ctx, 'frequency', T.repeated, 'repeated' as const)
      ?? set(ctx, 'frequency', T.oneTime, 'one_time' as const)
      ?? 'unknown',
    escalation:
      set(ctx, 'escalation', T.worsening, 'getting_worse' as const)
      ?? set(ctx, 'escalation', T.stable, 'stable' as const)
      ?? 'unknown',
    threats,
    intoxication:
      set(ctx, 'intoxication', T.notIntoxicated, 'no' as const)
      ?? set(ctx, 'intoxication', T.intoxicated, 'yes' as const)
      ?? 'unknown',
    people_affected:
      set(ctx, 'people_affected', T.community, 'community' as const)
      ?? set(ctx, 'people_affected', T.few, 'few' as const)
      ?? 'unknown',
    property_damage:
      set(ctx, 'property_damage', T.damageNone, 'none' as const)
      ?? set(ctx, 'property_damage', T.damageMajor, 'major' as const)
      ?? set(ctx, 'property_damage', T.damageMinor, 'minor' as const)
      ?? 'unknown',
    reporter_safety:
      set(ctx, 'reporter_safety', T.unsafe, 'unsafe' as const)
      ?? set(ctx, 'reporter_safety', T.safe, 'safe' as const)
      ?? 'unknown',
    prior_cases:
      typeof input.priorCases === 'number' ? (input.priorCases > 0 ? 'some' : 'none') : 'unknown',
    evidence: [
      ...(input.attachments?.photos ? ['photo' as const] : []),
      ...(input.attachments?.documents || confirmed ? ['document' as const] : []),
      ...(find(ctx.text, ctx.original, T.witness, ctx.blocked) ? ['witness' as const] : []),
    ],
  };

  // ── Hard rules. Each may raise the level; none may lower it. ──
  const applied: string[] = [];
  let level: RiskLevelName = 'Low';
  const raise = (to: RiskLevelName, rule: string) => {
    if (!applied.includes(rule)) applied.push(rule);
    level = higherLevel(level, to);
  };

  const hasVulnerable = parameters.vulnerable_person.some(v => v !== 'unknown' && v !== 'none');

  // Force already applied, quoted like any other finding. Without this the
  // report "hinampas ako ng asawa ko" raised the level on rule H3 and then
  // explained itself as a nuisance, because nothing had written down why.
  const physicalForce = find(ctx.text, ctx.original, T.physical, ctx.blocked);
  if (physicalForce) ctx.quotes.push({ parameter: 'physical_force', quote: physicalForce.quote });

  const abuseOrThreat =
    parameters.injury !== 'none' && parameters.injury !== 'unknown'
    || (parameters.threats !== 'none' && parameters.threats !== 'unknown')
    || Boolean(physicalForce);

  if (parameters.immediate_danger === 'yes') raise('Critical', 'H1');
  if (hasVulnerable && abuseOrThreat) raise('High', 'H2');

  const householdViolence =
    (parameters.relationship === 'intimate_partners' || parameters.relationship === 'family')
    && abuseOrThreat;
  if (householdViolence) raise('High', 'H3');

  if ((parameters.weapon === 'present' || parameters.weapon === 'used')
    && (parameters.threats !== 'none' && parameters.threats !== 'unknown'
      || (parameters.injury !== 'none' && parameters.injury !== 'unknown'))) {
    raise('High', 'H4');
  }
  if (parameters.injury === 'serious') raise('Critical', 'H5');
  if (parameters.injury === 'needs_treatment') raise('High', 'H5');

  const quietDispute =
    category === 'neighbor_community_dispute'
    && parameters.injury !== 'minor' && parameters.injury !== 'needs_treatment' && parameters.injury !== 'serious'
    && parameters.weapon !== 'present' && parameters.weapon !== 'used'
    && !hasVulnerable;
  if (quietDispute && applied.length === 0) {
    applied.push('H6');
    level = parameters.frequency === 'repeated' ? 'Medium' : 'Low';
  }

  // ── Score. Built from what was found, then reconciled to the level. ──
  //
  // Acts the hard rules do not name still have to carry their weight. H1-H5
  // cover danger, vulnerability, household violence, weapons and injury; none
  // of them covers a reported rape of an adult who did not describe an injury,
  // and the level must not rest on whether she did. The score path can raise
  // the level on its own, so these are weighed here rather than invented as a
  // parameter the report never stated.
  const sexualViolence = find(ctx.text, ctx.original, T.sexualViolence, ctx.blocked);
  if (sexualViolence) ctx.quotes.push({ parameter: 'sexual_violence', quote: sexualViolence.quote });
  const unwantedTouching = find(ctx.text, ctx.original, T.harassment, ctx.blocked);
  const stalking = find(ctx.text, ctx.original, T.stalking, ctx.blocked);

  let raw = 8;
  if (sexualViolence) raw += 45;
  else if (unwantedTouching) raw += 22;
  if (stalking) raw += 18;
  if (physicalForce) raw += 14;
  if (parameters.frequency === 'repeated') raw += 12;
  if (parameters.escalation === 'getting_worse') raw += 10;
  if (parameters.threats === 'verbal') raw += 10;
  if (parameters.threats === 'explicit') raw += 18;
  if (parameters.intoxication === 'yes') raw += 8;
  if (parameters.property_damage === 'minor') raw += 6;
  if (parameters.property_damage === 'major') raw += 14;
  if (parameters.reporter_safety === 'unsafe') raw += 10;
  if (parameters.prior_cases === 'some') raw += 6;
  if (parameters.people_affected === 'community') raw += 4;

  // "Several unknowns about danger" is in the MEDIUM band's own description,
  // and H7 says those unknowns must never make a case look safer. It is held
  // to reports that found something: a page of keyboard noise has every
  // unknown there is, and routing it as MEDIUM buries the cases that are.
  const dangerUnknowns = [
    parameters.injury === 'unknown',
    parameters.weapon === 'unknown',
    parameters.immediate_danger === 'unknown',
    parameters.vulnerable_person.includes('unknown'),
  ].filter(Boolean).length;
  const foundSomething = raw > 8;
  if (dangerUnknowns >= 3 && foundSomething && !applied.includes('H6')) {
    raw = Math.max(raw, minScoreForLevel('Medium'));
  }

  // A score that reaches a higher band is evidence too, but it can only raise.
  level = higherLevel(level, levelForScore(raw));
  const score = reconcileScore(Math.max(raw, minScoreForLevel(level)), level);

  // ── Unknowns are recorded, never used to reassure. ──
  const missing: string[] = [];
  const askIf = (cond: boolean, q: string) => { if (cond) missing.push(q); };
  askIf(parameters.frequency === 'unknown', 'How often this has happened');
  askIf(parameters.injury === 'unknown', 'Whether anyone was injured');
  askIf(parameters.weapon === 'unknown', 'Whether a weapon was involved');
  askIf(parameters.vulnerable_person.includes('unknown'), 'Whether a child or dependent person was involved');
  askIf(parameters.immediate_danger === 'unknown', 'Whether anyone is in danger right now');
  askIf(parameters.relationship === 'unknown', 'How the people involved know each other');

  const unclearUsed = (input.unclearWords ?? []).length > 0;

  /**
   * A factor that makes harm more likely, sitting next to an injury nobody
   * stated. The gap matters more than either half: alcohol on a collision
   * report with no word on injuries is the difference between a citation and
   * a hospital, and the system must not settle that by guessing.
   */
  const aggravatorWithoutInjury = parameters.injury === 'unknown' && (
    parameters.intoxication === 'yes' ? 'Alcohol was reported'
      : parameters.weapon === 'present' || parameters.weapon === 'used' ? 'A weapon was reported'
        : parameters.threats !== 'none' && parameters.threats !== 'unknown' ? 'Threats were reported'
          : null);

  // H7 does not move the level - it is the rule that stops the level moving
  // down. Plain unknowns are already handled without it: they never lower a
  // level and they go into missing_information. It is recorded for the case
  // the rule actually names, an unreadable detail, where a factor was found
  // and then withheld; recording it on every report with an open question
  // would put it on nearly all of them and tell an officer nothing.
  if (unclearUsed) applied.push('H7');

  const needs_human_review = unclearUsed || Boolean(aggravatorWithoutInjury)
    || missing.length >= 4 || level === 'Critical';
  const needs_human_review_reason = unclearUsed
    ? `Part of the attached document was unclear and was not used: ${(input.unclearWords ?? []).slice(0, 5).join(', ')}.`
    : level === 'Critical'
      ? 'The report indicates danger that an officer should see immediately.'
      : aggravatorWithoutInjury
        ? `${aggravatorWithoutInjury} and injury is not stated.`
        : missing.length >= 4
          ? 'Several details that affect the assessment are not stated in the report.'
          : '';

  // ── Explanation: reasons only, never a level name. ──
  const reasons: string[] = [];
  if (hasVulnerable) reasons.push('a vulnerable person is described');
  if (parameters.injury !== 'none' && parameters.injury !== 'unknown') reasons.push(`an injury described as ${parameters.injury.replace(/_/g, ' ')}`);
  if (parameters.weapon === 'present' || parameters.weapon === 'used') reasons.push(`a weapon ${parameters.weapon}`);
  if (parameters.threats === 'verbal' || parameters.threats === 'explicit') reasons.push(`${parameters.threats} threats`);
  if (parameters.frequency === 'repeated') reasons.push('the behaviour is repeated');
  if (parameters.escalation === 'getting_worse') reasons.push('it is reported as getting worse');
  if (parameters.intoxication === 'yes') reasons.push('alcohol is mentioned');
  if (parameters.immediate_danger === 'yes') reasons.push('danger is described as present now');
  if (physicalForce) reasons.push('physical force is described');
  if (householdViolence) reasons.push('the people involved live together or are partners');

  // The reassuring sentence belongs to H6 alone. Said next to a raised level
  // it reads as a contradiction, which is worse than saying nothing: the
  // resident is told their case is a nuisance while it is routed as urgent.
  const detail = reasons.length
    ? reasons.join('; ')
    : applied.includes('H6') && !applied.some(r => r !== 'H6' && r !== 'H7')
      ? 'only a nuisance was reported, with no injury, weapon, or person at risk described'
      : applied.every(r => r === 'H6' || r === 'H7')
        // True without being reassuring: it reports what the words did not say,
        // which is not the same as saying the case is minor.
        ? 'the report does not state an injury, a weapon, or anyone in danger'
        : 'the report describes circumstances that call for an officer to read it';

  const explanation = stripLevelWords(
    detail.charAt(0).toUpperCase() + detail.slice(1) + '.',
  );

  const recommended_review: Classification['recommended_review'] =
    level === 'Critical' || parameters.immediate_danger === 'yes' ? 'Urgent Human Review'
      : level === 'High' ? 'Priority Review'
        : level === 'Medium' ? 'Priority Review'
          : 'Standard Review';

  return {
    case_category: category,
    category_confidence,
    parameters,
    // One quote per parameter, the first that supported it.
    evidence_from_report: ctx.quotes.filter(
      (q, i, all) => all.findIndex(o => o.parameter === q.parameter) === i,
    ),
    routing_hints: {
      // Single-barangay deployment: the parties are local unless stated.
      same_city_or_municipality: 'yes',
      light_offense_for_mediation:
        level === 'Low' && category === 'neighbor_community_dispute' ? 'yes'
          : level === 'High' || level === 'Critical' ? 'no' : 'unknown',
      government_party: find(ctx.text, ctx.original, T.govt, ctx.blocked) ? 'yes' : 'unknown',
      partner_or_household_violence: householdViolence ? 'yes' : 'unknown',
      child_involved: parameters.vulnerable_person.includes('minor') ? 'yes' : 'unknown',
      police_referral_suggested:
        parameters.injury === 'serious' || parameters.weapon === 'used'
          || parameters.immediate_danger === 'yes' ? 'yes' : 'unknown',
      disaster_or_hazard: find(ctx.text, ctx.original, T.hazard, ctx.blocked) ? 'yes' : 'unknown',
    },
    risk_level: level.toUpperCase() as Classification['risk_level'],
    score,
    // Confidence falls with every unanswered question rather than being asserted.
    confidence: Math.max(35, 95 - missing.length * 10 - (unclearUsed ? 15 : 0)),
    hard_rules_applied: applied,
    detected_risk_factors: reasons,
    explanation,
    recommended_review,
    missing_information: missing,
    needs_human_review,
    needs_human_review_reason,
  };
}

/**
 * The level after the hard rules have had their say.
 *
 * The rest of the system reaches a level its own way - the resident path
 * through the six assessment factors, the walk-in path through the scoring
 * engine. This is the floor underneath both of them: a report that names a
 * child being hurt, a weapon with a threat, or someone still at the door
 * cannot come out Low because a weighted average landed there. The rules only
 * ever raise, so a path that already read the report as worse keeps its own
 * answer.
 */
export function enforceHardRules(
  engineLevel: RiskLevelName,
  input: ClassificationInput,
): { level: RiskLevelName; classification: Classification } {
  const classification = classifyCase(input);
  const ruled = LEVEL_OF[classification.risk_level];
  return {
    level: classification.hard_rules_applied.some(r => r !== 'H6' && r !== 'H7')
      ? higherLevel(engineLevel, ruled)
      : engineLevel,
    classification,
  };
}

/** The classifier reports SHOUTING levels; the database stores Title Case. */
const LEVEL_OF: Record<Classification['risk_level'], RiskLevelName> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical',
};
