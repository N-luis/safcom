/**
 * Contextual risk analysis for a reported incident, in Filipino, Tagalog,
 * English or a mixture.
 *
 * The corpus and the banding come from the barangay's own LOW / MEDIUM / HIGH
 * reference sheets and their risk-factor table, and every labelled example in
 * those sheets is covered by the test suite.
 *
 * The rule the whole module exists to enforce is that a level is never assigned
 * from a single keyword or from the case category. What raises a report is the
 * combination: what was done, how severe, how often, whether it is escalating,
 * and whether anyone is in danger right now.
 *
 * Severe indicators are the one exception, deliberately — strangulation, a
 * weapon, a death threat, being prevented from calling for help. Waiting for a
 * second signal is the wrong error to make there.
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

/**
 * severe   — enough on its own.
 * moderate — needs a combination to reach High.
 * low      — verbal, emotional, controlling, online harassment.
 * context  — aggravating circumstances that are reported alongside the acts
 *            (fear, a prior incident, a weapon-free threat of reprisal). Shown
 *            to the officer, but never counted as an act in its own right.
 */
type Tier = 'severe' | 'moderate' | 'low' | 'context';

interface FactorDef {
  id: string;
  label: string;
  tier: Tier;
  terms: string[];
  /** Physical force applied to the person — repetition of this reaches High. */
  strike?: boolean;
  /** Skip the match when the verb is aimed at an object ("sinipa ang upuan"). */
  objectSensitive?: boolean;
}

export interface DetectedFactor {
  id: string;
  label: string;
  tier: Tier;
  /** Phrases taken from the report. Never paraphrased. */
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
  severeTrigger: boolean;
}

const FACTORS: FactorDef[] = [
  // ── Severe ────────────────────────────────────────────────────────────────
  {
    id: 'strangulation', label: 'Strangulation or choking', tier: 'severe',
    terms: ['sinakal', 'sakalin', 'sinasakal', 'choke', 'choked', 'choking', 'strangl', 'hinigpitan ang leeg'],
  },
  {
    id: 'weapon', label: 'Weapon involvement', tier: 'severe',
    terms: [
      'kutsilyo', 'itak', 'baril', 'balisong', 'armas', 'matalim na bagay',
      'gamit ang isang bagay', 'gamit ng isang bagay',
      'knife', 'bladed', 'gun', 'pistol', 'firearm', 'weapon', 'machete', 'ice pick',
    ],
  },
  {
    id: 'death-threat', label: 'Death threat', tier: 'severe',
    terms: [
      'papatayin', 'patayin kita', 'kill you', 'kill me', 'going to kill',
      'death threat', 'threatened to kill',
    ],
  },
  {
    id: 'threat-family', label: 'Serious threat against family or children', tier: 'severe',
    terms: [
      'sasaktan ang anak', 'sasaktan ang mga anak', 'sasaktan niya ang anak', 'sasaktan niya ang mga anak',
      'sasaktan ang pamilya', 'kukunin ang anak', 'papatayin ang anak', 'papatayin ang pamilya',
      'papatayin ang buong pamilya',
      'hurt my child', 'hurt my children', 'hurt my family', 'harm my child',
    ],
  },
  {
    id: 'grave-threat', label: 'Threat of serious harm', tier: 'severe',
    terms: ['may masamang mangyayari', 'masamang mangyayari sa akin', 'something bad will happen to you'],
  },
  {
    id: 'severe-violence', label: 'Serious physical violence', tier: 'severe',
    terms: [
      'pinukpok', 'binugbog', 'bugbog', 'sinaksak', 'saksak', 'binaril',
      'sinunog', 'inapakan',
      'beat me', 'beaten', 'stabbed', 'shot me', 'bashed', 'battered',
    ],
  },
  {
    id: 'severe-injury', label: 'Severe injury', tier: 'severe',
    terms: [
      'malubhang injury', 'malubhang sugat', 'malubhang pinsala', 'malubha ang naging pinsala',
      'malubhang nasaktan', 'nabali', 'bali ang buto', 'nawalan ng malay',
      'dinala sa ospital', 'na-ospital', 'tinahi',
      'broken bone', 'fracture', 'unconscious', 'knocked out', 'stitches',
      'hospitalized', 'hospitalised', 'serious injury', 'severe injury', 'internal bleeding',
    ],
  },
  {
    id: 'coercion', label: 'Forced to go with the respondent', tier: 'severe',
    terms: ['pinilit akong sumama', 'pinilit niya akong sumama', 'sapilitang isinama', 'forced me to go'],
  },
  {
    id: 'prevented-help', label: 'Prevented from calling for help', tier: 'severe',
    terms: [
      'hindi ako makatawag ng tulong', 'hindi makatawag ng tulong',
      'para hindi ako makahingi ng tulong', 'hindi makahingi ng tulong',
      'prevented me from calling', 'stopped me from calling', 'keep me from calling',
      'could not call for help', "couldn't call for help",
    ],
  },
  {
    id: 'immediate-threat', label: 'Immediate danger', tier: 'severe',
    terms: [
      'nasa labas ng bahay ngayon', 'nasa labas ngayon', 'hinahanap niya ako', 'hinahanap ako ngayon',
      'andito siya ngayon', 'nandito siya ngayon', 'papunta siya dito',
      'outside my house now', 'he is here now', 'right outside', 'looking for me now',
      'is coming here', 'currently in danger',
    ],
  },

  // ── Moderate ──────────────────────────────────────────────────────────────
  {
    // Force applied to the person. Repetition of these reaches High.
    id: 'physical-strike', label: 'Physical violence', tier: 'moderate', strike: true, objectSensitive: true,
    terms: [
      'sinampal', 'sampal', 'sinuntok', 'suntok', 'sinipa', 'sipa',
      // Not 'saktan ako': it matches inside 'sasaktan ako', which is a threat
      // of harm, not harm that happened.
      'sinaktan', 'sinasaktan', 'pananakit', 'nanakit', 'sinabunutan', 'pinilipit',
      'slapped', 'punched', 'kicked', 'hit me', 'struck me', 'hurt me',
    ],
  },
  {
    // Force that restrains or shoves rather than strikes.
    id: 'physical-aggression', label: 'Physical aggression', tier: 'moderate', objectSensitive: true,
    terms: [
      'tinulak', 'itinulak', 'tinutulak', 'hinila', 'kinaladkad', 'nang mahigpit',
      'pushed', 'shoved', 'grabbed', 'dragged', 'pulled my hair',
    ],
  },
  {
    id: 'intimidation', label: 'Intimidation or property damage', tier: 'moderate',
    terms: [
      'sinuntok ang pader', 'sinipa ang upuan', 'hinampas', 'binasag', 'binalibag',
      'tinakot', 'takutin', 'tinatakot', 'nananakot',
      // Breaking things in front of someone is the same act of intimidation,
      // so it is one factor rather than two.
      'sinira ang gamit', 'sinira ang ibang gamit', 'sinira ang cellphone', 'sinira ang bahay',
      'tinapon ang cellphone', 'tinapon ang gamit', 'sinira niya ang',
      'punched the wall', 'smashed', 'threw things', 'threw a chair', 'intimidat',
      'broke my phone', 'destroyed my', 'smashed my phone',
    ],
  },
  {
    id: 'threats', label: 'Threats', tier: 'moderate',
    terms: [
      'binabantaan', 'nagbabanta', 'nagbanta', 'pinagbantaan', 'pinagbabantaan', 'banta niya',
      'sasaktan', 'pagsisisihan', 'may mangyayari sa akin',
      'hahayaang makipaghiwalay', 'hindi niya ako hahayaang',
      'pupuntahan niya ako sa trabaho', 'pupuntahan ako sa trabaho',
      'threatened', 'threatening', 'threat to hurt',
    ],
  },
  {
    id: 'stalking', label: 'Stalking or repeated unwanted contact', tier: 'moderate',
    terms: [
      'sinusundan', 'sinundan', 'naghihintay sa labas', 'pumupunta sa trabaho ko',
      'pumupunta sa bahay ko', 'trabaho ko kahit', "iba't ibang numero", 'ibang numero',
      'tinatawagan', 'inimbitahan',
      'following me', 'follows me', 'followed me home', 'waiting outside my work',
      'stalking', 'keeps calling', 'different numbers',
    ],
  },
  {
    id: 'restriction', label: 'Restriction of movement', tier: 'moderate',
    terms: [
      'hinarangan', 'hinarang', 'hindi ako makalabas', 'hindi ako makaalis',
      'hindi ako pinayagang umalis', 'hindi ako pinapayagang umalis',
      'hindi ako pinalabas', 'pinigilan akong umalis', 'ikinulong', 'kinandado',
      'blocked the door', 'blocked my way', 'would not let me out', 'kept me inside',
      'prevented me from leaving', 'locked me in',
    ],
  },
  {
    id: 'control', label: 'Financial or social control', tier: 'moderate',
    terms: [
      'kinuha ang dokumento', 'kinuha ang mga importanteng dokumento', 'ayaw niyang ibalik',
      'ayaw niya itong ibalik', 'ayaw itong ibalik',
      'kinukuha ang pera ko', 'hindi ako binibigyan ng sapat', 'hindi niya ako binibigyan',
      'payagang magtrabaho', 'ayaw akong payagang magtrabaho',
      'pinipigilan akong makipag-usap', 'kinuha ang atm', 'kinuha ang sweldo',
      'took my documents', 'took my id', 'withholding money', 'controls my money',
      'stopped me from talking to my family',
    ],
  },
  {
    id: 'injury', label: 'Injury', tier: 'moderate',
    terms: ['may sugat', 'nagkasugat', 'may pasa', 'nagkapasa', 'dumudugo', 'nagdudugo', 'bruise', 'bleeding'],
  },

  // ── Low ───────────────────────────────────────────────────────────────────
  {
    id: 'verbal-abuse', label: 'Verbal abuse', tier: 'low',
    terms: [
      'minura', 'minumura', 'mura niya', 'sinigawan', 'sinisigawan', 'nanigaw', 'pinagsisigawan',
      'masasamang salita', 'pagsalitaan nang masama',
      'cursed', 'curses', 'swore at me', 'yelled', 'shouted at me', 'screamed at me',
    ],
  },
  {
    id: 'emotional-abuse', label: 'Emotional abuse', tier: 'low',
    terms: [
      'pinahiya', 'pinapahiya', 'kinukutya', 'minamaliit', 'walang kwenta',
      'wala akong mararating', 'wala akong silbi', 'pinagtatawanan', 'sinisiraan ako',
      'humiliated', 'belittled', 'called me worthless', 'put me down',
    ],
  },
  {
    id: 'controlling', label: 'Controlling behaviour', tier: 'low',
    terms: [
      'pinagbabawalan', 'pinagbawalan', 'kinokontrol', 'ayaw niyang makipagkaibigan',
      'tinatanong kung nasaan', 'kung sino ang kausap', 'para tingnan ang messages',
      'nagagalit siya kapag', 'sinusuri ang cellphone ko',
      'forbids me', 'not allowed to go out', 'checks my phone', 'controls who i talk to',
    ],
  },
  {
    id: 'harassment', label: 'Harassment', tier: 'low',
    terms: [
      'minemessage', 'hindi tumitigil sa pagmessage', 'nagpo-post', 'nagpopost',
      'gumagawa siya ng mga account', 'akong kontakin', 'sa social media',
      'keeps messaging', 'harassing me online', 'posted about me',
    ],
  },

  // ── Context ───────────────────────────────────────────────────────────────
  {
    id: 'retaliation', label: 'Threat of reprisal for reporting', tier: 'context',
    terms: [
      'kapag nagsumbong', 'pag nagsumbong', 'kapag magrereklamo', 'kapag nagreport',
      'kapag nagsalita ako', 'if i report', 'if i tell', 'if i call the police',
    ],
  },
  {
    id: 'victim-fear', label: 'Reporter states they are afraid', tier: 'context',
    terms: [
      'takot ako', 'natakot ako', 'natatakot ako', 'kinakabahan ako', 'nangangamba ako',
      'i am afraid', "i'm afraid", 'im afraid', 'i am scared', 'i fear for', 'terrified',
    ],
  },
  {
    id: 'previous-incident', label: 'Earlier incident reported', tier: 'context',
    terms: ['may naunang', 'naunang pananakit', 'dati nang nangyari', 'nangyari na dati', 'happened before'],
  },
  {
    id: 'knows-location', label: 'Respondent knows where the reporter lives', tier: 'context',
    terms: ['alam niya kung saan ako nakatira', 'alam niya kung saan ako', 'knows where i live'],
  },
  {
    id: 'vulnerable-person', label: 'Minor or dependent person involved', tier: 'context',
    terms: [
      'anak ko', 'mga anak ko', 'bata', 'menor de edad', 'buntis', 'matanda', 'may kapansanan',
      'my child', 'my children', 'minor', 'elderly', 'pregnant',
    ],
  },
];

const FREQUENCY_TERMS: { value: Frequency; terms: string[] }[] = [
  { value: 'One-time', terms: ['isang beses lang', 'isang beses', 'ngayon lang', 'first time', 'unang beses', 'one time'] },
  { value: 'Ongoing', terms: ['hanggang ngayon', 'patuloy', 'tuloy-tuloy', 'hindi pa tumitigil', 'still happening', 'ongoing', 'continues'] },
  { value: 'Frequent', terms: ['araw-araw', 'gabi-gabi', 'palagi', 'lagi', 'madalas', 'every day', 'every night', 'daily', 'constantly'] },
  {
    value: 'Repeated',
    terms: [
      'paulit-ulit', 'paulit ulit', 'ilang beses', 'maraming beses', 'ulit na naman', 'lagi na lang',
      'repeatedly', 'again and again', 'multiple times', 'several times', 'many times',
      'second time', 'third time', 'not the first', 'keeps happening',
    ],
  },
  { value: 'Occasional', terms: ['minsan', 'paminsan-minsan', 'sometimes', 'occasionally', 'once in a while'] },
];

const ESCALATION_TERMS = [
  'lumalala', 'mas lumalala', 'mas malala', 'palala nang palala', 'dumadalas',
  'mas madalas na', 'mas matindi', 'dati ay', 'noong una ay', 'pero ngayon ay',
  'nitong mga nakaraang', 'ngayon ay mas',
  'getting worse', 'worse each', 'worse every', 'escalating', 'more violent', 'more frequent',
];

/**
 * Denials of the act itself — "wala naman siyang sinaktan o binantaan". Within
 * the sentence that carries one, nothing serious is counted: the report is
 * saying the opposite.
 */
const ACT_DENIAL = [
  'wala naman siyang', 'wala naman", "wala siyang sinabing', 'wala siyang sinabing',
  'wala siyang sinaktan', 'walang sinaktan', 'wala siyang ginawa', 'hindi niya ako sinaktan',
  'did not hurt', "didn't hurt", 'no physical harm',
];

/**
 * Denials of severity only — "hindi ako malubhang nasaktan". The act still
 * happened, so only the severe reading is withdrawn.
 */
const SEVERITY_DENIAL = [
  'hindi ako malubhang', 'hindi malubha', 'wala akong malubhang', 'walang malubhang',
  'hindi naman malala', 'no serious injury', 'not seriously hurt',
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
 * Tagalog puts a pronoun inside the phrase — "hinarangan NIYA ang pinto" —
 * which splits any phrase written without one. Matching against a
 * pronoun-stripped copy lets one written form cover both.
 */
function stripPronouns(text: string): string {
  return text.replace(/\b(niya|siya|nya|ninyo)\b/g, ' ').replace(/\s+/g, ' ');
}

/** Body parts are still the person, so "ang braso ko" is not an object. */
const BODY_PARTS = ['braso', 'kamay', 'buhok', 'leeg', 'ulo', 'mukha', 'paa', 'binti', 'tiyan', 'likod'];

/** The verb is aimed at an object, not the person: "sinipa ang upuan". */
function hitsAnObject(compact: string, term: string): boolean {
  const i = compact.indexOf(term);
  if (i === -1) return false;
  const after = compact.slice(i + term.length, i + term.length + 24);
  if (!after.startsWith(' ang')) return false;
  return !BODY_PARTS.some(b => after.includes(b));
}

interface Clause { raw: string; text: string; compact: string; actDenied: boolean; severityDenied: boolean }

/** Sentence-scoped so a denial in one sentence cannot erase another's facts. */
function toClauses(original: string): Clause[] {
  return original
    .split(/(?<=[.!?\n])\s+/)
    .map(raw => {
      const text = normalise(raw);
      return {
        raw: raw.trim(),
        text,
        compact: stripPronouns(text),
        actDenied: ACT_DENIAL.some(c => text.includes(c)),
        severityDenied: SEVERITY_DENIAL.some(c => text.includes(c)),
      };
    })
    .filter(c => c.text.trim().length > 0);
}

function detectFrequency(clauses: Clause[]): Frequency {
  for (const { value, terms } of FREQUENCY_TERMS) {
    if (clauses.some(c => terms.some(t => c.text.includes(t) || c.compact.includes(t)))) return value;
  }
  return 'Unknown';
}

function isRepeated(f: Frequency): boolean {
  return f === 'Repeated' || f === 'Frequent' || f === 'Ongoing';
}

export function analyseReport(report: string): GbvAnalysis {
  const original = report ?? '';
  const clauses = toClauses(original);

  if (!clauses.length) {
    return {
      level: 'Low', detectedFactors: [], severityIndicators: [],
      frequency: 'Unknown', escalation: 'Unknown', immediateDanger: 'Unclear',
      reason: 'No description was provided, so no risk indicators could be read from the report.',
      recommendedReview: 'Routine Review',
      missingInformation: ['A description of what happened'],
      severeTrigger: false,
    };
  }

  const detected: DetectedFactor[] = [];
  for (const f of FACTORS) {
    const evidence: string[] = [];
    for (const c of clauses) {
      // A denial withdraws the serious reading, unless the phrase is itself
      // phrased as a negative ("hindi ako pinayagang umalis").
      const suppressed =
        (f.tier === 'severe' && (c.actDenied || c.severityDenied))
        || (f.tier === 'moderate' && c.actDenied);

      for (const t of f.terms) {
        const selfNegating = t.includes('hindi') || t.includes('wala');
        if (suppressed && !selfNegating) continue;
        if (!(c.text.includes(t) || c.compact.includes(t))) continue;
        if (f.objectSensitive && hitsAnObject(c.compact, t)) continue;
        evidence.push(c.raw.length > 160 ? `${c.raw.slice(0, 157)}…` : c.raw);
        break;
      }
    }
    if (evidence.length) {
      detected.push({ id: f.id, label: f.label, tier: f.tier, evidence: [...new Set(evidence)].slice(0, 2) });
    }
  }

  const severe = detected.filter(d => d.tier === 'severe');
  const moderate = detected.filter(d => d.tier === 'moderate');
  const low = detected.filter(d => d.tier === 'low');
  const context = detected.filter(d => d.tier === 'context');

  const frequency = detectFrequency(clauses);
  const escalating = clauses.some(c => ESCALATION_TERMS.some(t => c.text.includes(t) || c.compact.includes(t)));
  const dangerNow = detected.some(d => d.id === 'immediate-threat');
  const fear = detected.some(d => d.id === 'victim-fear');
  const hasStrike = moderate.some(d => FACTORS.find(f => f.id === d.id)?.strike);
  const hasRestriction = moderate.some(d => d.id === 'restriction');

  const escalation: Escalation = escalating
    ? 'Present'
    : isRepeated(frequency) && (severe.length > 0 || moderate.length > 0)
      ? 'Possible'
      : detected.length === 0 ? 'Unknown' : 'None reported';

  // ── Level ────────────────────────────────────────────────────────────────
  // A severe indicator stands alone. Everything else is a combination.
  const level: RiskLevel =
    severe.length > 0 ? 'High'
      : escalating && moderate.length > 0 ? 'High'
        // Repetition only lifts force applied to the person; repeated calls or
        // repeated shoving stay Medium, as the reference sheets have them.
        : hasStrike && isRepeated(frequency) ? 'High'
          // Hurt while unable to leave.
          : hasRestriction && hasStrike ? 'High'
            : moderate.length >= 2 ? 'High'
              : moderate.length === 1 ? 'Medium'
                : low.length >= 3 && isRepeated(frequency) ? 'Medium'
                  : 'Low';

  const immediateDanger: ImmediateDanger =
    dangerNow ? 'Yes' : level === 'High' ? 'Unclear' : 'No';

  const recommendedReview: ReviewLevel =
    level === 'High' ? 'Urgent Human Review'
      : level === 'Medium' ? 'Priority Review'
        : 'Routine Review';

  const severityIndicators = [...severe, ...moderate]
    .flatMap(d => d.evidence.map(e => `${d.label}: “${e}”`))
    .slice(0, 5);

  // ── Reason, built only from what was found ──────────────────────────────
  const acts = [...severe, ...moderate, ...(severe.length || moderate.length ? [] : low)];
  const parts: string[] = [];
  if (acts.length) parts.push(`the report describes ${acts.map(d => d.label.toLowerCase()).join(', ')}`);
  if (isRepeated(frequency)) parts.push(`the behaviour is described as ${frequency.toLowerCase()}`);
  if (escalating) parts.push('the report describes it getting worse over time');
  if (fear) parts.push('the reporter states they are afraid');
  if (dangerNow) parts.push('the report indicates danger at the time of writing');
  const otherContext = context.filter(c => c.id !== 'victim-fear');
  if (otherContext.length) parts.push(otherContext.map(d => d.label.toLowerCase()).join(', '));

  const reason = parts.length
    ? `Classified ${level} because ${parts.join('; ')}.`
    : 'No specific risk indicators were identified in the description. Classified Low pending officer review.';

  // ── Missing information ─────────────────────────────────────────────────
  const missingInformation: string[] = [];
  if (frequency === 'Unknown') missingInformation.push('How often this has happened');
  if (!escalating && detected.length > 0) missingInformation.push('Whether the behaviour is getting worse');
  if (!detected.some(d => d.id === 'severe-injury' || d.id === 'injury')) {
    missingInformation.push('Whether anyone was injured and how seriously');
  }
  if (!detected.some(d => d.id === 'weapon')) missingInformation.push('Whether a weapon was present or accessible');
  if (!detected.some(d => d.id === 'vulnerable-person')) missingInformation.push('Whether children or other dependants were present');
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
