/**
 * Contextual risk analysis for a reported incident, in Filipino, Tagalog,
 * English or a mixture.
 *
 * The rule this module exists to enforce is that a level is never assigned from
 * a single keyword or from the case category. What raises a report is the
 * combination of what was done, how severe it was, how often, whether it is
 * escalating, and whether anyone is in danger right now.
 *
 * Severe indicators are the one exception, and deliberately so: strangulation,
 * a weapon, a death threat or being prevented from calling for help are enough
 * on their own, because waiting for a second signal is the wrong error to make.
 *
 * The output is an initial indicator for an officer to review. It does not
 * decide guilt, does not diagnose anyone, and never asserts anything the report
 * did not say.
 */

export type RiskLevel = 'Low' | 'Medium' | 'High';
export type Frequency = 'One-time' | 'Occasional' | 'Repeated' | 'Frequent' | 'Ongoing' | 'Unknown';
export type Escalation = 'None reported' | 'Possible' | 'Present' | 'Unknown';
export type ImmediateDanger = 'Yes' | 'No' | 'Unclear';
export type ReviewLevel = 'Routine Review' | 'Priority Review' | 'Urgent Human Review';

/** Severity band a factor belongs to. */
type Tier = 'severe' | 'moderate' | 'low';

interface FactorDef {
  id: string;
  /** One of the 16 factor names the assessment reports against. */
  label: string;
  tier: Tier;
  /** Matched against the normalised report text. */
  terms: string[];
}

export interface DetectedFactor {
  id: string;
  label: string;
  tier: Tier;
  /** The exact phrases from the report that matched. Never paraphrased. */
  evidence: string[];
}

export interface GbvAnalysis {
  level: RiskLevel;
  detectedFactors: DetectedFactor[];
  severityIndicators: string[];
  frequency: Frequency;
  escalation: Escalation;
  immediateDanger: ImmediateDanger;
  reason: string;
  recommendedReview: ReviewLevel;
  missingInformation: string[];
  /** True when the level came from a severe indicator rather than a combination. */
  severeTrigger: boolean;
}

/**
 * Terms are stems chosen to survive Tagalog affixes: "sinaktan", "sasaktan"
 * and "pananakit" are separate entries rather than one loose "sakit", which
 * would also match "masakit ang ulo ko".
 */
const FACTORS: FactorDef[] = [
  // ── Severe ────────────────────────────────────────────────────────────────
  {
    id: 'strangulation', label: 'Strangulation or choking', tier: 'severe',
    terms: ['sinakal', 'sakalin', 'sinasakal', 'choke', 'choked', 'choking', 'strangl', 'hinigpitan ang leeg'],
  },
  {
    id: 'weapon', label: 'Weapon involvement', tier: 'severe',
    terms: [
      'kutsilyo', 'itak', 'baril', 'balisong', 'may armas', 'dala niyang armas', 'armas',
      'knife', 'bladed', 'gun', 'pistol', 'firearm', 'weapon', 'machete', 'ice pick',
    ],
  },
  {
    id: 'death-threat', label: 'Death threat', tier: 'severe',
    terms: [
      'papatayin', 'pinapatay niya ako', 'patayin kita', 'pinagbantaan na papatayin',
      'kill you', 'kill me', 'going to kill', 'death threat', 'threatened to kill',
    ],
  },
  {
    id: 'threat-family', label: 'Serious threat against family or children', tier: 'severe',
    terms: [
      'sasaktan ang anak', 'sasaktan ang pamilya', 'sasaktan niya ang anak',
      'kukunin ang anak', 'papatayin ang anak', 'papatayin ang pamilya',
      'hurt my child', 'hurt my children', 'hurt my family', 'harm my child',
    ],
  },
  {
    id: 'severe-violence', label: 'Serious physical violence', tier: 'severe',
    terms: [
      'pinukpok', 'binugbog', 'bugbog', 'sinaksak', 'saksak', 'binaril',
      'sinunog', 'inapakan', 'binato ng bato',
      'beat me', 'beaten', 'stabbed', 'shot me', 'bashed', 'battered',
    ],
  },
  {
    id: 'severe-injury', label: 'Severe injury', tier: 'severe',
    terms: [
      'malubhang injury', 'malubhang sugat', 'nabali', 'bali ang buto', 'nawalan ng malay',
      'dinala sa ospital', 'na-ospital', 'tinahi',
      'broken bone', 'fracture', 'unconscious', 'knocked out', 'stitches',
      'hospitalized', 'hospitalised', 'serious injury', 'severe injury', 'internal bleeding',
    ],
  },
  {
    id: 'retaliation', label: 'Retaliation threat for reporting', tier: 'severe',
    terms: [
      'kapag nagsumbong', 'pag nagsumbong', 'kapag magrereklamo', 'kapag nagreport',
      'kapag nagsalita ako', 'pagsisisihan ko',
      'if i report', 'if i tell', 'if i call the police', 'if you report',
    ],
  },
  {
    id: 'prevented-help', label: 'Prevented from escaping or calling for help', tier: 'severe',
    terms: [
      'hindi ako makatawag ng tulong', 'hindi makatawag ng tulong', 'para hindi ako makahingi ng tulong',
      'prevented me from calling', 'stopped me from calling', 'keep me from calling',
      'hindi ako pinapayagang umalis', 'hindi ako pinalabas', 'ikinulong ako', 'nakakulong ako',
      'could not call for help', 'couldn’t call for help', 'stop me from calling',
      'prevented me from leaving', 'would not let me leave', 'locked me in', 'locked in',
    ],
  },
  {
    id: 'immediate-threat', label: 'Immediate danger', tier: 'severe',
    terms: [
      'nasa labas siya ngayon', 'nasa labas ng bahay ngayon', 'hinahanap niya ako',
      'andito siya ngayon', 'nandito siya ngayon', 'papunta siya dito',
      'outside my house now', 'he is here now', 'right outside', 'looking for me now',
      'is coming here', 'currently in danger',
    ],
  },

  // ── Moderate ──────────────────────────────────────────────────────────────
  {
    id: 'physical-aggression', label: 'Physical aggression', tier: 'moderate',
    terms: [
      'tinulak', 'itinulak', 'sinampal', 'sampal', 'sinuntok', 'suntok', 'sinipa', 'sipa',
      'hinila', 'kinaladkad', 'hinawakan nang mahigpit', 'nang mahigpit', 'pinilipit', 'sinabunutan',
      'sinaktan', 'sasaktan', 'saktan', 'pananakit', 'nanakit',
      'pushed', 'shoved', 'slapped', 'punched', 'kicked', 'grabbed', 'dragged',
      'pulled my hair', 'hit me', 'hurt me', 'struck me',
    ],
  },
  {
    id: 'intimidation', label: 'Intimidation', tier: 'moderate',
    terms: [
      'sinuntok ang pader', 'binasag', 'sinira ang', 'binalibag', 'pinagbantaan',
      'tinakot', 'takutin', 'nananakot',
      'punched the wall', 'smashed', 'threw things', 'threw a chair', 'intimidat',
    ],
  },
  {
    id: 'threats', label: 'Threats', tier: 'moderate',
    terms: [
      'binabantaan', 'nagbabanta', 'banta niya', 'sinabi niyang sasaktan',
      'threatened', 'threatening', 'threat to hurt',
    ],
  },
  {
    id: 'stalking', label: 'Stalking or repeated unwanted contact', tier: 'moderate',
    terms: [
      'sinusundan', 'sinundan niya ako', 'nagbabantay sa labas', 'pumupunta sa trabaho ko',
      'iba’t ibang numero', 'ibang numero', 'paulit-ulit tinatawagan',
      'trabaho ko kahit ayaw ko', 'pumupunta sa trabaho ko',
      'following me', 'follows me', 'followed me home', 'waiting outside my work',
      'stalking', 'keeps calling', 'different numbers',
    ],
  },
  {
    id: 'restriction', label: 'Restriction of movement', tier: 'moderate',
    terms: [
      'hinarangan ang pinto', 'hinarang ang pinto', 'hinarangan', 'hindi ako makalabas',
      'hindi ako pinalabas ng kwarto',
      'pinigilan akong umalis', 'kinandado',
      'blocked the door', 'blocked my way', 'would not let me out', 'kept me inside',
    ],
  },
  {
    id: 'property-destruction', label: 'Property destruction used as intimidation', tier: 'moderate',
    terms: [
      'sinira ang cellphone', 'sinira ang gamit', 'binasag ang', 'sinira niya ang',
      'broke my phone', 'destroyed my', 'smashed my phone',
    ],
  },
  {
    id: 'control', label: 'Financial or social control', tier: 'moderate',
    terms: [
      'kinuha ang dokumento', 'kinuha ang mga importanteng dokumento', 'ayaw ibalik',
      'pinipigilan akong makipag-usap', 'hindi ako binibigyan ng pera',
      'kinuha ang atm', 'kinuha ang sweldo',
      'took my documents', 'took my id', 'withholding money', 'controls my money',
      'stopped me from talking to my family',
    ],
  },

  // ── Low ───────────────────────────────────────────────────────────────────
  {
    id: 'verbal-abuse', label: 'Verbal abuse', tier: 'low',
    terms: [
      'minura', 'minumura', 'mura niya', 'sinigawan', 'sigaw niya', 'pinagsisigawan',
      'cursed', 'curses', 'swore at me', 'yelled', 'shouted at me', 'screamed at me',
    ],
  },
  {
    id: 'emotional-abuse', label: 'Emotional abuse', tier: 'low',
    terms: [
      'pinahiya', 'kinukutya', 'minamaliit', 'walang kwenta', 'wala akong mararating',
      'sinisiraan ako', 'pinapahiya ako',
      'humiliated', 'belittled', 'called me worthless', 'put me down',
    ],
  },
  {
    id: 'controlling', label: 'Controlling behaviour', tier: 'low',
    terms: [
      'pinagbabawalan', 'ayaw niyang makipagkaibigan', 'gusto niyang malaman kung sino ang kausap',
      'sinusuri ang cellphone ko', 'chinecheck ang phone ko',
      'forbids me', 'not allowed to go out', 'checks my phone', 'controls who i talk to',
    ],
  },
  {
    id: 'harassment', label: 'Harassment', tier: 'low',
    terms: [
      'paulit-ulit niya akong minemessage', 'minemessage kahit ayaw ko', 'hindi tumitigil sa pagmessage',
      'pinapahiya sa social media', 'inaano ako online',
      'keeps messaging', 'harassing me online', 'posted about me',
    ],
  },
];

const FREQUENCY_TERMS: { value: Frequency; terms: string[] }[] = [
  {
    value: 'Ongoing',
    terms: ['hanggang ngayon', 'patuloy', 'tuloy-tuloy', 'hindi pa tumitigil', 'still happening', 'ongoing', 'continues'],
  },
  {
    value: 'Frequent',
    terms: ['araw-araw', 'gabi-gabi', 'palagi', 'lagi', 'madalas', 'every day', 'every night', 'daily', 'constantly'],
  },
  {
    value: 'Repeated',
    terms: [
      'paulit-ulit', 'paulit ulit', 'ilang beses', 'maraming beses', 'ulit na naman', 'lagi na lang',
      'repeatedly', 'again and again', 'multiple times', 'several times', 'many times',
      'second time', 'third time', 'not the first', 'keeps happening',
    ],
  },
  {
    value: 'Occasional',
    terms: ['minsan', 'paminsan-minsan', 'sometimes', 'occasionally', 'once in a while'],
  },
  {
    value: 'One-time',
    terms: ['ngayon lang', 'first time', 'unang beses', 'one time', 'isang beses lang'],
  },
];

const ESCALATION_TERMS = [
  'lumalala', 'mas lumalala', 'mas malala', 'palala nang palala', 'dumadalas',
  'mas madalas na', 'mas matindi',
  'getting worse', 'worse each', 'worse every', 'escalating', 'more violent', 'more frequent',
];

const FEAR_TERMS = [
  'takot ako', 'natatakot ako', 'kinakabahan ako', 'hindi ako makatulog sa takot',
  'i am afraid', 'i’m afraid', 'im afraid', 'i am scared', 'i fear for', 'terrified',
];

/** Lowercases and strips accents so Tagalog matches regardless of typing. */
function normalise(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Tagalog puts a pronoun inside the phrase - "hinarangan NIYA ang pinto",
 * "nasa labas SIYA ng bahay" - which splits any phrase written without one.
 * Matching also against a pronoun-stripped copy lets one written form cover
 * both, instead of needing an entry per pronoun position.
 */
function stripPronouns(text: string): string {
  return text.replace(/\b(niya|siya|nya|ninyo)\b/g, ' ').replace(/\s+/g, ' ');
}

/** True when the term appears, with or without the interposed pronoun. */
function mentions(text: string, compact: string, term: string): boolean {
  return text.includes(term) || compact.includes(term);
}

/** The sentence a term appeared in, so evidence quotes the report itself. */
function sentenceContaining(original: string, term: string): string {
  const sentences = original.split(/(?<=[.!?\n])\s+/);
  const hit = sentences.find(s => {
    const n = normalise(s);
    return n.includes(term) || stripPronouns(n).includes(term);
  });
  const chosen = (hit ?? original).trim();
  return chosen.length > 160 ? `${chosen.slice(0, 157)}…` : chosen;
}

function detectFrequency(text: string, compact: string): Frequency {
  for (const { value, terms } of FREQUENCY_TERMS) {
    if (terms.some(t => mentions(text, compact, t))) return value;
  }
  return 'Unknown';
}

/** Repeated or worse — the bands that let a moderate report rise to High. */
function isRepeated(f: Frequency): boolean {
  return f === 'Repeated' || f === 'Frequent' || f === 'Ongoing';
}

export function analyseReport(report: string): GbvAnalysis {
  const original = report ?? '';
  const text = normalise(original);
  const compact = stripPronouns(text);

  if (!text.trim()) {
    return {
      level: 'Low',
      detectedFactors: [],
      severityIndicators: [],
      frequency: 'Unknown',
      escalation: 'Unknown',
      immediateDanger: 'Unclear',
      reason: 'No description was provided, so no risk indicators could be read from the report.',
      recommendedReview: 'Routine Review',
      missingInformation: ['A description of what happened'],
      severeTrigger: false,
    };
  }

  const detected: DetectedFactor[] = [];
  for (const f of FACTORS) {
    const hits = f.terms.filter(t => mentions(text, compact, t));
    if (hits.length) {
      detected.push({
        id: f.id, label: f.label, tier: f.tier,
        evidence: [...new Set(hits.map(t => sentenceContaining(original, t)))].slice(0, 2),
      });
    }
  }

  const severe = detected.filter(d => d.tier === 'severe');
  const moderate = detected.filter(d => d.tier === 'moderate');
  const low = detected.filter(d => d.tier === 'low');

  const frequency = detectFrequency(text, compact);
  const escalating = ESCALATION_TERMS.some(t => mentions(text, compact, t));
  const fear = FEAR_TERMS.some(t => mentions(text, compact, t));
  const dangerNow = detected.some(d => d.id === 'immediate-threat');

  const escalation: Escalation = escalating
    ? 'Present'
    : isRepeated(frequency) && (severe.length > 0 || moderate.length > 0)
      ? 'Possible'
      : detected.length === 0 ? 'Unknown' : 'None reported';

  // ── Level ────────────────────────────────────────────────────────────────
  // A severe indicator stands alone. Anything else has to be a combination:
  // repetition, escalation, or several distinct moderate behaviours together.
  const moderateCombination =
    moderate.length > 0 && (isRepeated(frequency) || escalating || moderate.length >= 3);

  const level: RiskLevel =
    severe.length > 0 || moderateCombination ? 'High'
      : moderate.length > 0 ? 'Medium'
        : low.length > 0 && isRepeated(frequency) && low.length >= 2 ? 'Medium'
          : low.length > 0 ? 'Low'
            : 'Low';

  const immediateDanger: ImmediateDanger =
    dangerNow ? 'Yes'
      : severe.length > 0 ? 'Unclear'
        : level === 'High' ? 'Unclear'
          : 'No';

  const recommendedReview: ReviewLevel =
    dangerNow || severe.length > 0 ? 'Urgent Human Review'
      : level === 'High' ? 'Urgent Human Review'
        : level === 'Medium' ? 'Priority Review'
          : 'Routine Review';

  const severityIndicators = [
    ...severe.flatMap(d => d.evidence.map(e => `${d.label}: “${e}”`)),
    ...moderate.flatMap(d => d.evidence.map(e => `${d.label}: “${e}”`)),
  ].slice(0, 5);

  // ── Reason, built only from what was actually found ──────────────────────
  const parts: string[] = [];
  if (severe.length) {
    parts.push(`the report describes ${severe.map(d => d.label.toLowerCase()).join(', ')}`);
  }
  if (moderate.length) {
    parts.push(`${severe.length ? 'and ' : 'the report describes '}${moderate.map(d => d.label.toLowerCase()).join(', ')}`);
  }
  if (!severe.length && !moderate.length && low.length) {
    parts.push(`the report describes ${low.map(d => d.label.toLowerCase()).join(', ')}`);
  }
  if (isRepeated(frequency)) parts.push(`the behaviour is described as ${frequency.toLowerCase()}`);
  if (escalating) parts.push('the report describes the behaviour getting worse over time');
  if (fear) parts.push('the reporter states they are afraid');
  if (dangerNow) parts.push('the report indicates danger at the time of writing');

  const reason = parts.length
    ? `Classified ${level} because ${parts.join('; ')}.`
    : 'No specific risk indicators were identified in the description. Classified Low pending officer review.';

  // ── Missing information ─────────────────────────────────────────────────
  const missingInformation: string[] = [];
  if (frequency === 'Unknown') missingInformation.push('How often this has happened');
  if (!escalating && detected.length > 0) missingInformation.push('Whether the behaviour is getting worse');
  if (!severe.some(d => d.id === 'severe-injury')) missingInformation.push('Whether anyone was injured and how seriously');
  if (!detected.some(d => d.id === 'weapon')) missingInformation.push('Whether a weapon was present or accessible');
  if (!detected.some(d => d.id === 'threat-family')) missingInformation.push('Whether children or other dependants were present');
  if (immediateDanger === 'Unclear') missingInformation.push('Whether the reporter is safe right now');

  return {
    level, detectedFactors: detected, severityIndicators, frequency, escalation,
    immediateDanger, reason, recommendedReview,
    missingInformation: missingInformation.slice(0, 5),
    severeTrigger: severe.length > 0,
  };
}

/** Shown only on High, per the configured workflow. Never sent anywhere. */
export const PNP_CONTACT_NUMBER = '0998-598-5376';
