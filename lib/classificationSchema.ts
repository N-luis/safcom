import { VAWC_TYPES } from './vawcTypes';

/**
 * The case classification matrix.
 *
 * One entry per case category SafeComm supports: what it means, how a report
 * is recognised as one, which desk handles it, the law it sits under, what an
 * officer must confirm before treating it as that category, and which of the
 * risk rules usually bear on it. The Case Classification pages read the
 * display fields; the assisted intake (lib/intake.ts) reads the rest.
 *
 * STATUS - DRAFT. The legal references below are the statutes these
 * categories ordinarily fall under, listed so an officer knows where to look.
 * They are not legal advice and not a determination. The criteria, the
 * references and the routing have NOT yet been approved by the barangay's
 * legal officer or VAWC desk, and should be before this is relied on. Edit
 * this file to change them; tests/classificationSchema.test.ts checks that
 * every edit still leaves each case type with exactly one well-formed entry.
 *
 * What the matrix never does: decide a risk level from a category. Risk comes
 * from the facts a report states and the hard rules in caseClassification.
 * `riskBias` below is the office's display guidance only.
 */

export const MATRIX_VERSION = '2026-10-draft-1';
export const MATRIX_REVIEW_STATUS =
  'Draft — criteria and legal references pending review by the barangay legal officer and VAWC desk.';

/** Facts read from the report and answers. Each is quoted when it is used. */
export type Signal =
  | 'force' | 'threat' | 'injury' | 'weapon'
  | 'partner' | 'family' | 'neighbors' | 'minor'
  | 'sexualViolence' | 'harassment' | 'stalking' | 'trafficking'
  | 'economicAbuse' | 'emotionalAbuse'
  | 'quarrel' | 'harmDenied'
  | 'theft' | 'vandalism' | 'trespass' | 'cyber' | 'traffic' | 'drugs' | 'gambling'
  | 'noise' | 'nuisance' | 'boundary'
  | 'construction' | 'animalBite' | 'pets' | 'utility' | 'sanitation' | 'infrastructure';

/** Matches when every `all`, at least one `any` (if given), and no `none` is present. */
export interface MatchRule { all?: Signal[]; any?: Signal[]; none?: Signal[] }

export interface CategoryMeta {
  category: string;
  code: string;
  color: string;
  /** Display guidance for the classification page. Never sets a case's level. */
  riskBias: 'Critical' | 'High' | 'Medium' | 'Low';
  description: string;

  desk: 'VAWC' | 'Blotter';
  /** What a report must describe to be this category. */
  definition: string;
  /** How the intake recognises it. Any one rule matching is enough. Empty = never suggested automatically. */
  rules: MatchRule[];
  /** Higher wins when a report matches more than one. */
  priority: number;
  /** Where an officer looks. References, not conclusions. */
  legalBasis: string[];
  /** Facts the report cannot settle that an officer must confirm. */
  confirm: string[];
  /** Whether Katarungang Pambarangay conciliation can be considered. */
  conciliation: 'not_allowed' | 'check_exceptions' | 'not_applicable';
  /** Usual referral beyond the barangay, when there is one. */
  referral?: string;
  /** Which hard rules usually decide the level for this kind of report. */
  riskCriteria: string;
}

const KP = 'RA 7160 (Local Government Code) §§399–422, Katarungang Pambarangay — check the §408 exceptions';
const VAWC_CONFIRM = [
  'The person harmed is a woman, or her child (RA 9262 covers women and their children). SafeComm does not infer gender.',
  'The person responsible is a current or former spouse, partner or dating partner, or shares a child with her.',
];

export const BLOTTER_CATEGORIES: CategoryMeta[] = [
  { category: 'Drug-Related', code: 'DRG', color: '#ec4899', riskBias: 'Critical',
    description: 'Possession, distribution and paraphernalia',
    desk: 'Blotter', definition: 'Use, sale or possession of illegal drugs is described.',
    rules: [{ any: ['drugs'] }], priority: 70,
    legalBasis: ['RA 9165 (Comprehensive Dangerous Drugs Act of 2002)'],
    confirm: [], conciliation: 'not_allowed', referral: 'PNP / PDEA',
    riskCriteria: 'H1 if danger is present now; H4 if a weapon is involved.' },
  { category: 'Assault', code: 'AST', color: '#ef4444', riskBias: 'Critical',
    description: 'Physical altercations, threats and battery',
    desk: 'Blotter',
    definition: 'Force, injury, a weapon or a threat between people who are not partners or family, and with no child involved.',
    rules: [{ any: ['force', 'injury', 'weapon', 'threat'], none: ['partner', 'family', 'minor'] }], priority: 65,
    legalBasis: ['Revised Penal Code, physical injuries (Arts. 262–266) and threats (Arts. 282–283)', KP],
    confirm: ['Whether the injuries are serious enough to take it outside barangay conciliation.'],
    conciliation: 'check_exceptions', referral: 'PNP, if serious injury or a weapon',
    riskCriteria: 'H1 danger now; H4 weapon with threat or harm; H5 injury needing treatment.' },
  { category: 'Theft & Robbery', code: 'TRB', color: '#14b8a6', riskBias: 'High',
    description: 'Larceny, burglary, robbery and motor vehicle theft',
    desk: 'Blotter', definition: 'Something was taken, or a home or vehicle was broken into.',
    rules: [{ any: ['theft'] }], priority: 60,
    legalBasis: ['Revised Penal Code, robbery and theft (Arts. 293–310)', KP],
    confirm: ['Whether force or intimidation was used (robbery) or not (theft).'],
    conciliation: 'check_exceptions', referral: 'PNP, for robbery',
    riskCriteria: 'H1 if the person is still there; H4 if armed.' },
  { category: 'Cybercrime', code: 'CYB', color: '#8b5cf6', riskBias: 'High',
    description: 'Online fraud, identity theft, cyberbullying, data breaches',
    desk: 'Blotter', definition: 'Fraud, harassment or an attack carried out online or through a phone or e-wallet.',
    rules: [{ any: ['cyber'] }], priority: 58,
    legalBasis: ['RA 10175 (Cybercrime Prevention Act of 2012)'],
    confirm: [], conciliation: 'not_applicable', referral: 'PNP Anti-Cybercrime Group or NBI',
    riskCriteria: 'Usually Low unless threats or a minor are involved (H2).' },
  { category: 'Vandalism', code: 'VAN', color: '#f59e0b', riskBias: 'Low',
    description: 'Property damage, graffiti, destruction of public property',
    desk: 'Blotter', definition: 'Property was damaged or defaced.',
    rules: [{ any: ['vandalism'] }], priority: 56,
    legalBasis: ['Revised Penal Code, malicious mischief (Arts. 327–331)', KP],
    confirm: [], conciliation: 'check_exceptions',
    riskCriteria: 'Usually Low; raised only by threats or harm to a person.' },
  { category: 'Trespassing', code: 'TRS', color: '#84cc16', riskBias: 'Medium',
    description: 'Entering or remaining on property without permission',
    desk: 'Blotter', definition: 'Someone entered or stayed on property without permission.',
    rules: [{ any: ['trespass'] }], priority: 54,
    legalBasis: ['Revised Penal Code, trespass (Arts. 280–281)', KP],
    confirm: [], conciliation: 'check_exceptions',
    riskCriteria: 'H1 if the person is still there.' },
  { category: 'Traffic Violation', code: 'TRF', color: '#0891b2', riskBias: 'Medium',
    description: 'Road collisions and traffic incidents',
    desk: 'Blotter', definition: 'A collision or other road incident is described.',
    rules: [{ any: ['traffic'] }], priority: 52,
    legalBasis: ['RA 4136 (Land Transportation and Traffic Code)', KP],
    confirm: ['Whether anyone was injured.'], conciliation: 'check_exceptions',
    referral: 'Traffic enforcement / PNP, if anyone was injured',
    riskCriteria: 'H5 if an injury needs treatment.' },
  { category: 'Animal Bite/Concern', code: 'ANI', color: '#a16207', riskBias: 'Medium',
    description: 'Animal bites, stray or dangerous animals',
    desk: 'Blotter', definition: 'An animal bit someone, or a stray or dangerous animal is a concern.',
    rules: [{ any: ['animalBite', 'pets'] }], priority: 50,
    legalBasis: ['RA 9482 (Anti-Rabies Act of 2007)'],
    confirm: ['Whether the person bitten has been seen for post-exposure treatment.'],
    conciliation: 'check_exceptions', referral: 'Health centre / animal bite treatment centre',
    riskCriteria: 'H5 if a bite needs treatment.' },
  { category: 'Illegal Construction', code: 'CON', color: '#78716c', riskBias: 'Low',
    description: 'Building without a permit or encroaching on public land',
    desk: 'Blotter', definition: 'Building or extension work without a permit, or on land that is not the builder’s.',
    rules: [{ any: ['construction'] }], priority: 48,
    legalBasis: ['PD 1096 (National Building Code of the Philippines)'],
    confirm: [], conciliation: 'not_applicable', referral: 'Municipal Building Official',
    riskCriteria: 'Usually Low.' },
  { category: 'Noise Complaint', code: 'NSE', color: '#0ea5e9', riskBias: 'Low',
    description: 'Sustained noise disturbing a household or a street',
    desk: 'Blotter', definition: 'Noise that disturbs a household or a street.',
    rules: [{ any: ['noise'] }], priority: 46,
    legalBasis: ['Civil Code, nuisance (Arts. 694–707) and local ordinances', KP],
    confirm: [], conciliation: 'check_exceptions',
    riskCriteria: 'Usually Low; raised only by threats or harm.' },
  { category: 'Sanitation Concern', code: 'SAN', color: '#65a30d', riskBias: 'Low',
    description: 'Garbage, clogged drains and sanitation hazards',
    desk: 'Blotter', definition: 'Garbage, drainage or another sanitation problem.',
    rules: [{ any: ['sanitation'] }], priority: 44,
    legalBasis: ['RA 9003 (Ecological Solid Waste Management Act of 2000) and local ordinances'],
    confirm: [], conciliation: 'not_applicable', riskCriteria: 'Usually Low.' },
  { category: 'Utility Problem', code: 'UTL', color: '#0d9488', riskBias: 'Low',
    description: 'Water and electricity supply problems',
    desk: 'Blotter', definition: 'A problem with water or electricity supply.',
    rules: [{ any: ['utility'] }], priority: 42,
    legalBasis: ['Local ordinances; the utility provider’s own procedures'],
    confirm: [], conciliation: 'not_applicable', referral: 'The water or electricity provider',
    riskCriteria: 'Usually Low.' },
  { category: 'Infrastructure Issue', code: 'INF', color: '#64748b', riskBias: 'Low',
    description: 'Roads, drainage, lighting and other barangay facilities',
    desk: 'Blotter', definition: 'Damaged roads, lighting or other barangay facilities.',
    rules: [{ any: ['infrastructure'] }], priority: 40,
    legalBasis: ['Local ordinances'], confirm: [], conciliation: 'not_applicable',
    riskCriteria: 'Usually Low.' },
  { category: 'Domestic Dispute', code: 'DDS', color: '#f97316', riskBias: 'High',
    description: 'Family conflict and household disputes with no abuse alleged',
    desk: 'Blotter',
    definition: 'A disagreement between partners or family members, where the resident has said no one was hurt and no force or threat is described.',
    // Only once harm has been ruled out by the resident. Before that, a
    // partner or family report is not assumed to be "just an argument".
    rules: [{ all: ['quarrel', 'harmDenied'], any: ['partner', 'family'], none: ['minor'] }], priority: 38,
    legalBasis: [KP],
    confirm: ['That no abuse has occurred — if it has, this is a VAWC matter and is not for conciliation.'],
    conciliation: 'check_exceptions', riskCriteria: 'Usually Low.' },
  { category: 'Public Nuisance', code: 'PNS', color: '#3b82f6', riskBias: 'Medium',
    description: 'Noise complaints, illegal dumping, obstruction of public areas',
    desk: 'Blotter', definition: 'Gambling, loitering, obstruction, boundary disputes, or a quarrel between neighbours.',
    rules: [{ any: ['nuisance', 'gambling', 'boundary'] }, { all: ['quarrel', 'neighbors'], none: ['force', 'threat', 'injury'] }],
    priority: 36,
    legalBasis: ['Civil Code, nuisance (Arts. 694–707) and local ordinances', KP],
    confirm: [], conciliation: 'check_exceptions', riskCriteria: 'Usually Low.' },
  { category: 'Other', code: 'OTH', color: '#94a3b8', riskBias: 'Medium',
    description: 'Other / Needs Review — anything the list does not cover; read the report itself',
    desk: 'Blotter', definition: 'Used when the report does not support any category with confidence. Needs an officer to classify.',
    rules: [], priority: 0,
    legalBasis: [], confirm: ['What the report actually describes.'], conciliation: 'check_exceptions',
    riskCriteria: 'Decided by the facts stated; no category rule applies.' },
];

/**
 * The VAWC desk's categories, in the office's order.
 *
 * `riskBias` here is High or Critical for every one, as display guidance; it
 * does not set any case's level.
 */
export const VAWC_CATEGORIES: CategoryMeta[] = [
  { category: 'Domestic Violence', code: 'DV', color: '#ef4444', riskBias: 'Critical',
    description: 'Abuse by a spouse, partner or former partner, in or out of the home',
    desk: 'VAWC',
    definition: 'Physical force, a threat, an injury or a weapon by a current or former spouse or partner.',
    rules: [{ all: ['partner'], any: ['force', 'threat', 'injury', 'weapon'] }], priority: 90,
    legalBasis: ['RA 9262 (Anti-Violence Against Women and Their Children Act of 2004), §3 and §5',
      'RA 9262 §14 — Barangay Protection Order'],
    confirm: VAWC_CONFIRM, conciliation: 'not_allowed', referral: 'PNP Women and Children Protection Desk',
    riskCriteria: 'H3 (partner violence, at least High); H1 danger now; H4 weapon; H5 injury.' },
  { category: 'Physical Abuse', code: 'PHY', color: '#f43f5e', riskBias: 'Critical',
    description: 'Bodily harm inflicted on a woman or a child',
    desk: 'VAWC',
    definition: 'Force, an injury or a weapon by a family member who is not a partner.',
    rules: [{ all: ['family'], any: ['force', 'injury', 'weapon'], none: ['partner'] }], priority: 82,
    legalBasis: ['RA 7610 if the person harmed is a child', 'Revised Penal Code, physical injuries (Arts. 262–266)'],
    confirm: ['Whether the person harmed is a woman or a child, and their relationship to the person responsible.'],
    conciliation: 'not_allowed', riskCriteria: 'H3 (family violence, at least High); H5 injury.' },
  { category: 'Sexual Harassment', code: 'SH', color: '#f97316', riskBias: 'High',
    description: 'Unwanted sexual conduct, including at work or in public',
    desk: 'VAWC', definition: 'Unwanted sexual remarks, touching or conduct, in public, online, at work or in school.',
    rules: [{ any: ['harassment'] }], priority: 78,
    legalBasis: ['RA 11313 (Safe Spaces Act)', 'RA 7877 (Anti-Sexual Harassment Act of 1995), where there is authority or influence'],
    confirm: ['Where it happened and the relationship between the people (public space, work, school, online).'],
    conciliation: 'not_allowed', riskCriteria: 'H2 if a child is involved.' },
  { category: 'Child Abuse', code: 'CA', color: '#8b5cf6', riskBias: 'Critical',
    description: 'Harm, neglect or exploitation of a minor',
    desk: 'VAWC', definition: 'Harm, a threat, or sexual conduct towards a child.',
    // Not when a partner is involved: RA 9262 already covers a woman's
    // children under Domestic Violence, and "while our child watched" must
    // not turn a partner assault into a child abuse case.
    rules: [{ all: ['minor'], any: ['force', 'injury', 'threat', 'weapon', 'sexualViolence', 'harassment'], none: ['partner'] }], priority: 96,
    legalBasis: ['RA 7610 (Special Protection of Children Against Abuse, Exploitation and Discrimination Act)',
      'RA 9262, where the person responsible is the mother’s partner'],
    confirm: ['The child’s age, and who is caring for the child now.'],
    conciliation: 'not_allowed', referral: 'MSWDO / PNP Women and Children Protection Desk',
    riskCriteria: 'H2 (child with harm or threat, at least High); H1 danger now.' },
  { category: 'Stalking', code: 'STK', color: '#a855f7', riskBias: 'High',
    description: 'Repeated following, watching or contact that causes fear',
    desk: 'VAWC', definition: 'Repeated following, watching or unwanted contact.',
    rules: [{ any: ['stalking'] }], priority: 80,
    legalBasis: ['RA 9262 §5(h), where the person is a partner or former partner', 'RA 11313 (Safe Spaces Act), in public spaces'],
    confirm: VAWC_CONFIRM.slice(1), conciliation: 'not_allowed',
    riskCriteria: 'H1 if the person is present now; recurrence raises urgency.' },
  { category: 'Emotional Abuse', code: 'EMO', color: '#6366f1', riskBias: 'High',
    description: 'Intimidation, humiliation and controlling behaviour',
    desk: 'VAWC', definition: 'Repeated insults, humiliation or control by a partner or family member.',
    rules: [{ all: ['emotionalAbuse'], any: ['partner', 'family'] }], priority: 84,
    legalBasis: ['RA 9262 §3(c), psychological violence'],
    confirm: VAWC_CONFIRM, conciliation: 'not_allowed',
    riskCriteria: 'Raised by threats (H3) or a child being present (H2).' },
  { category: 'Economic Abuse', code: 'ECO', color: '#0ea5e9', riskBias: 'High',
    description: 'Withholding money, property or the means to support oneself',
    desk: 'VAWC', definition: 'Support, money, wages or property withheld or taken by a partner or family member.',
    rules: [{ all: ['economicAbuse'], any: ['partner', 'family'] }], priority: 86,
    legalBasis: ['RA 9262 §3(d), economic abuse'],
    confirm: VAWC_CONFIRM, conciliation: 'not_allowed', riskCriteria: 'Usually decided by other facts stated.' },
  { category: 'Sexual Violence', code: 'SV', color: '#dc2626', riskBias: 'Critical',
    description: 'Rape and other sexual assault',
    desk: 'VAWC', definition: 'Rape or another sexual assault is described.',
    rules: [{ any: ['sexualViolence'] }], priority: 95,
    legalBasis: ['RA 8353 (Anti-Rape Law of 1997), as amended by RA 11648', 'RA 9262 §3(b), where the person is a partner'],
    confirm: [], conciliation: 'not_allowed', referral: 'PNP Women and Children Protection Desk; medical examination',
    riskCriteria: 'At least High by its nature; H1 if danger is present now.' },
  { category: 'Human Trafficking', code: 'HT', color: '#be123c', riskBias: 'Critical',
    description: 'Recruitment or transport of a person for exploitation',
    desk: 'VAWC', definition: 'A person recruited, moved, sold or forced to work for exploitation.',
    rules: [{ any: ['trafficking'] }], priority: 100,
    legalBasis: ['RA 9208 (Anti-Trafficking in Persons Act), as amended by RA 10364 and RA 11862'],
    confirm: [], conciliation: 'not_allowed', referral: 'PNP / IACAT',
    riskCriteria: 'H1 if the person is still under control now.' },
  { category: 'VAWC - Other', code: 'OTH', color: '#94a3b8', riskBias: 'High',
    description: 'VAWC - Other / Needs Review — a report the list above does not cover; read it in full',
    desk: 'VAWC',
    definition: 'Used when a report involves a partner, family member, child or sexual conduct but does not support a specific category. Kept on the VAWC desk so it stays confidential while it is reviewed.',
    rules: [], priority: 0,
    legalBasis: [], confirm: ['What the report actually describes.'], conciliation: 'not_allowed',
    riskCriteria: 'Decided by the facts stated; no category rule applies.' },
];

export const ALL_CATEGORIES: CategoryMeta[] = [...VAWC_CATEGORIES, ...BLOTTER_CATEGORIES];

/** Signals that make an unclassifiable report a VAWC-desk matter while it is reviewed. */
export const SENSITIVE_SIGNALS: Signal[] = ['partner', 'family', 'minor', 'sexualViolence', 'harassment', 'stalking'];

/** The fallback for a report no rule matches. */
export function needsReviewCategory(signals: Set<Signal>): CategoryMeta {
  const sensitive = SENSITIVE_SIGNALS.some(s => signals.has(s));
  return ALL_CATEGORIES.find(c => c.category === (sensitive ? 'VAWC - Other' : 'Other'))!;
}

export function ruleMatches(rule: MatchRule, signals: Set<Signal>): boolean {
  if (rule.all && !rule.all.every(s => signals.has(s))) return false;
  if (rule.any && rule.any.length && !rule.any.some(s => signals.has(s))) return false;
  if (rule.none && rule.none.some(s => signals.has(s))) return false;
  return Boolean(rule.all?.length || rule.any?.length);
}

/** Every category the report matches, best first, with the signals that matched. */
export function matchCategories(signals: Set<Signal>): { meta: CategoryMeta; matched: Signal[] }[] {
  return ALL_CATEGORIES
    .map(meta => {
      const rule = meta.rules.find(r => ruleMatches(r, signals));
      if (!rule) return null;
      const matched = [...(rule.all ?? []), ...(rule.any ?? []).filter(s => signals.has(s))];
      return { meta, matched };
    })
    .filter((m): m is { meta: CategoryMeta; matched: Signal[] } => m !== null)
    .sort((a, b) => b.meta.priority - a.meta.priority);
}

export function categoryByName(name: string | null | undefined): CategoryMeta | null {
  return ALL_CATEGORIES.find(c => c.category === name) ?? null;
}

/** Guidance for a category, or a neutral entry so an unknown type still shows. */
export function metaFor(category: string, set: CategoryMeta[]): CategoryMeta {
  return set.find(c => c.category === category) ?? {
    category,
    code: category.slice(0, 3).toUpperCase(),
    color: '#94a3b8',
    riskBias: 'Medium',
    description: 'Not on the office’s category list; read the report itself.',
    desk: 'Blotter', definition: '', rules: [], priority: 0, legalBasis: [], confirm: [],
    conciliation: 'check_exceptions', riskCriteria: '',
  };
}

export const VAWC_CATEGORY_NAMES: readonly string[] = VAWC_TYPES;
