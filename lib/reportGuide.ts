/**
 * The Reporting Assistant on File a Report - the parts that need no server:
 * what it may say about SafeComm (taken from the app itself, never invented),
 * the questions it suggests, its answers when the AI is unavailable, the
 * checks every AI answer must pass, and the next steps for a draft.
 *
 * The assistant explains and guides. It never decides: the desk it mentions
 * is the one SafeComm's own rules recommend (lib/reportDesk.ts), labelled as
 * a possibility; an official decides the desk and the category.
 */
import { EMERGENCY_HOTLINES } from './emergencyHotlines';
import { STATUS_GROUPS } from './analytics';

export type GuideLang = 'en' | 'tl';
export type GuideDestination = 'BLOTTER' | 'VAWC' | 'NEEDS_CLARIFICATION' | 'STAFF_REVIEW';
export const GUIDE_DESTINATIONS: GuideDestination[] = ['BLOTTER', 'VAWC', 'NEEDS_CLARIFICATION', 'STAFF_REVIEW'];
export const DESTINATION_LABEL: Record<GuideDestination, { en: string; tl: string }> = {
  BLOTTER: { en: 'Blotter desk', tl: 'Blotter desk' },
  VAWC: { en: 'VAWC desk (confidential)', tl: 'VAWC desk (kumpidensyal)' },
  NEEDS_CLARIFICATION: { en: 'Needs a little more information', tl: 'Kailangan pa ng kaunting impormasyon' },
  STAFF_REVIEW: { en: 'An official will decide the desk', tl: 'Isang opisyal ang magpapasya ng desk' },
};

export const GUIDE_INTRO: Record<GuideLang, string> = {
  en: "Hello! I'm SafeComm's AI Reporting Assistant. If you are unsure how to submit a report, what category to select, or what information to provide, I can guide you through the process. You can describe your concern naturally, and I will help you understand the next steps.",
  tl: 'Kumusta! Ako ang AI Reporting Assistant ng SafeComm. Kung hindi ka sigurado kung paano mag-report, anong kategorya ang pipiliin, o anong impormasyon ang ibibigay, matutulungan kita. Ikuwento mo lang ang nangyari sa sarili mong salita, at ipapaliwanag ko ang mga susunod na hakbang.',
};

export const SUGGESTED_QUESTIONS: Record<GuideLang, string[]> = {
  en: ['How do I report an incident?', 'What category should I choose?', 'What information do I need?', "What if I don't know the exact date?",
    "What if I don't have evidence?", 'What happens after I submit my report?', 'Can I report something that happened before?',
    "What if I'm reporting for another person?", 'Is my concern for Blotter or VAWC?'],
  tl: ['Paano mag-report ng insidente?', 'Anong kategorya ang pipiliin ko?', 'Anong impormasyon ang kailangan?', 'Paano kung hindi ko alam ang eksaktong petsa?',
    'Paano kung wala akong ebidensya?', 'Ano ang mangyayari pagkatapos kong mag-submit?', 'Puwede ko bang i-report ang nangyari dati pa?',
    'Paano kung para sa ibang tao ang report ko?', 'Blotter ba o VAWC ang concern ko?'],
};

/** What the assistant may say about SafeComm - from the app's own screens and settings. Sent to the AI as its only source of policy. */
export function workflowFacts(): string[] {
  const groups = Object.values(STATUS_GROUPS).map(g => `"${g.label}" (${g.statuses.join(', ')}): ${g.hint.toLowerCase()}`).join('; ');
  const hotlines = EMERGENCY_HOTLINES.map(h => `${h.name}: ${h.numbers.join(' / ')}`).join('; ');
  return [
    'Filing: the resident describes what happened in their own words on File a Report, says where it happened (the province, municipality and barangay, the street, and a map pin if they can), and may add the date, the time, the people involved, witnesses and photos. Only the description and the place are required.',
    'Only residents whose residency an official verified can file a standard report. An unverified resident can save a referral record for the barangay; urgent ones are marked urgent.',
    "Jurisdiction: SafeComm handles incidents in Barangay Biñang 2nd, Bocaue, Bulacan. SafeComm itself (its location check against the barangay's official boundary and street list - never the AI) decides from the incident place, not the reporter's home: inside, the report is filed as a SafeComm case; outside (another barangay, town or province), the same form is submitted as a referral, not a case, keeping everything entered, with a referral reference number; if the place cannot be confirmed (for example a street not on the barangay's list, or a map pin that does not match the barangay chosen), an official verifies the location first. The resident does not choose any of this.",
    'Referrals: the barangay reviews a referral to direct it to the responsible jurisdiction and posts updates in My Cases. No other barangay or agency has accepted a referral unless the barangay records their acknowledgment. Never name a receiving office or say which barangay a place belongs to - the resident can say which barangay they think it is, and SafeComm checks.',
    'Unknown details: the date, the time, names and evidence are optional. "I don\'t know", "not sure" and "I prefer not to answer" are all acceptable. A report is never refused for missing evidence.',
    'A past incident can be reported; give the approximate date if known.',
    'Who the report is for: the reporter (the person filing), the person affected, and the person reported are separate. The resident chooses: it involves me, or it involves someone else. The reporter is never assumed to be the person affected.',
    'SafeComm Assist reads the report and may ask a few follow-up questions; every one can be skipped.',
    'SafeComm recommends a desk - the Blotter desk, or the confidential VAWC desk - the resident does not have to choose a category. The recommendation is not a final decision: a barangay official decides the desk and the category.',
    'VAWC: reports that may involve violence against a woman or her child (RA 9262), for example by a husband, partner or ex-partner, go to the confidential VAWC desk, seen only by the officers assigned to it. VAWC matters are never mediated or conciliated (no Katarungang Pambarangay). Other disputes and incidents (noise, theft, threats between neighbours, property damage, etc.) go to the Blotter desk.',
    'After submitting: the resident gets a case reference number. A barangay official reviews the report and may ask for more information (shown in My Cases and Notifications). Updates appear in Notifications and My Cases; hearings and notices appear in My Hearings & Notices.',
    `Case statuses: ${groups}.`,
    'Privacy: other residents cannot see a report. VAWC reports are confidential.',
    'Emergencies: SafeComm is a reporting and case-monitoring platform, not an emergency response service. If anyone is in danger now, call the emergency hotlines first. Configured hotlines (the only numbers that may be given): ' + hotlines + '.',
    'SafeComm does not promise that a report will be accepted, how a case will end, or any deadline. Legal questions and anything not listed here need an authorized barangay official to confirm.',
  ];
}

// ── Intents and answers when the AI is unavailable ──────────────────────────

export type GuideIntent = 'how_to_report' | 'category' | 'what_info' | 'no_date' | 'no_evidence' | 'after_submit' | 'past_incident' | 'on_behalf' | 'outside_jurisdiction' | 'blotter_or_vawc' | 'urgent' | 'other';

const INTENT_RULES: [GuideIntent, RegExp][] = [
  ['blotter_or_vawc', /\bvawc\b|blotter (o|or|ba)|blotter\?/i],
  ['outside_jurisdiction', /ibang (barangay|bayan|munisipyo|lugar|probinsya)|labas ng (barangay|sakop|bi[ñn]ang)|outside (the |of )?(barangay|jurisdiction|bi[ñn]ang)|(other|another|different) (barangay|town|municipality|city|province)|\breferral\b|hindi (sakop|taga)/i],
  ['no_date', /\b(date|petsa|when|kailan|araw)\b.*\b(don'?t|not|hindi|di)\b|\b(don'?t|not|hindi|di)\b.*\b(date|petsa|kailan|eksaktong)\b|exact date|eksaktong petsa/i],
  ['no_evidence', /evidence|ebidensya|proof|patunay|litrato|picture|photo|document/i],
  ['after_submit', /after (i )?submit|pagkatapos|what happens|ano ang mangyayari|susunod|status|follow up|i-?follow/i],
  ['past_incident', /\b(before|previous|matagal|dati|noon|last (year|month)|nakaraan)\b/i],
  ['on_behalf', /behalf|for (another|someone|my (friend|neighbou?r|mother|father|sister|brother))|ibang tao|para sa (kaibigan|kapitbahay|nanay|tatay|kapatid)|third.?party/i],
  ['category', /categor|kategorya|which (type|kind)|anong (uri|klase)/i],
  ['what_info', /information|info|impormasyon|details|detalye|what (do )?i need|ano(ng)? (kailangan|ilalagay)/i],
  // "paano mag report", "pano po mag-report", "paano ba magfile", "paano i-report" - with or without the hyphen or a space.
  ['how_to_report', /how (do|can|should) i (report|file)|how to (report|file)|pa+no\s+(po\s+)?(ba\s+)?(mag[-\s]?(report|file|sumbong|ulat)|i-?report|magsumbong)|start/i],
];

/** Danger now, read from the resident's words - so the hotlines show at once, before any AI. */
export const URGENT_WORDS = /\b(emergency|in danger|right now|help me now|kill(ing)? me|has a (gun|knife)|bleeding|can'?t breathe|on fire|fire!|saklolo|tulungan (niyo|nyo|mo) (ako|kami)|papatayin|may (baril|kutsilyo|patalim)|nasusunog|duguan|hindi (ako )?makahinga|ngayon mismo|nandito pa siya|sinasaktan (ako|kami) ngayon)\b/i;

export function guideIntent(text: string): GuideIntent {
  if (URGENT_WORDS.test(text)) return 'urgent';
  for (const [intent, re] of INTENT_RULES) if (re.test(text)) return intent;
  return 'other';
}

/** The assistant's answer when the AI is off or its answer failed the checks: the same facts, written out. */
export const FALLBACK_ANSWERS: Record<GuideIntent, Record<GuideLang, string>> = {
  how_to_report: {
    en: 'On this page: describe what happened in your own words, choose where it happened, and add the date or people only if you know them. Then press Submit Report - SafeComm Assist may ask a few questions you can skip, and a barangay official reviews it.',
    tl: 'Dito sa pahinang ito: ikuwento ang nangyari sa sarili mong salita, piliin kung saan ito nangyari, at idagdag ang petsa o mga tao kung alam mo lang. Pindutin ang Submit Report - maaaring magtanong ang SafeComm Assist (puwedeng laktawan), at susuriin ito ng isang opisyal ng barangay.',
  },
  category: {
    en: "You don't have to choose a category. Describe what happened and SafeComm recommends the desk - Blotter or the confidential VAWC desk. A barangay official makes the final decision.",
    tl: 'Hindi mo kailangang pumili ng kategorya. Ikuwento ang nangyari at magrerekomenda ang SafeComm ng desk - Blotter o ang kumpidensyal na VAWC desk. Ang opisyal ng barangay ang magpapasya.',
  },
  what_info: {
    en: 'Helpful, if you know them: what happened, when, where (a landmark helps), who was involved, whether it happened before, what happened after, and whether anyone is in danger now. Leave out anything you do not know.',
    tl: 'Makakatulong kung alam mo: ano ang nangyari, kailan, saan (makakatulong ang palatandaan), sino ang sangkot, kung nangyari na ito dati, ano ang nangyari pagkatapos, at kung may nasa panganib ngayon. Iwanan ang hindi mo alam.',
  },
  no_date: {
    en: 'That is fine - the date is optional. Leave it blank, or describe it roughly in your story (for example "last week" or "around Christmas").',
    tl: 'Ayos lang - hindi kailangan ang eksaktong petsa. Iwanang blangko, o ilarawan lang sa kuwento (halimbawa, "noong isang linggo").',
  },
  no_evidence: {
    en: 'You can still report without evidence. Photos are optional; a report is never refused because there is no evidence.',
    tl: 'Puwede ka pa ring mag-report kahit walang ebidensya. Opsyonal ang litrato; hindi tatanggihan ang report dahil walang ebidensya.',
  },
  after_submit: {
    en: 'You get a case reference number. A barangay official reviews your report and may ask for more information. Follow it in My Cases and Notifications; hearings and notices appear under My Hearings & Notices.',
    tl: 'Makakatanggap ka ng case reference number. Susuriin ng opisyal ng barangay ang report at maaaring humingi ng dagdag na impormasyon. Makikita ang update sa My Cases at Notifications; ang mga hearing at abiso ay nasa My Hearings & Notices.',
  },
  past_incident: {
    en: 'Yes, you can report something that happened before. Give the approximate date if you know it, and say whether it has happened again.',
    tl: 'Oo, puwede mong i-report ang nangyari dati. Ilagay ang tinatayang petsa kung alam mo, at sabihin kung naulit ito.',
  },
  on_behalf: {
    en: 'Choose who the report is for at the top of the form: it involves you, or it involves someone else. You are the reporter; the person affected and the person reported are recorded separately - fill in only what you know.',
    tl: 'Piliin sa itaas ng form kung para kanino ang report: tungkol sa iyo, o tungkol sa ibang tao. Ikaw ang nag-uulat; hiwalay na itatala ang taong naapektuhan at ang inirereklamo - ilagay lang ang alam mo.',
  },
  outside_jurisdiction: {
    en: 'Fill in the same form and say where it happened. If the place is outside Barangay Biñang 2nd, SafeComm submits it as a referral, not a case - nothing you entered is lost - and the barangay directs it to the right jurisdiction. If the place cannot be confirmed, an official checks it first. If anyone is in danger now, call the emergency hotlines.',
    tl: 'Gamitin ang parehong form at sabihin kung saan nangyari. Kung nasa labas ng Barangay Biñang 2nd ang lugar, isusumite ito ng SafeComm bilang referral, hindi case - walang mawawala sa inilagay mo - at ididirekta ito ng barangay sa tamang hurisdiksyon. Kung hindi makumpirma ang lugar, susuriin muna ito ng opisyal. Kung may nasa panganib ngayon, tumawag sa emergency hotlines.',
  },
  blotter_or_vawc: {
    en: 'The VAWC desk handles violence or abuse against a woman or her child, for example by a husband, partner or ex-partner - it is confidential. Other incidents go to the Blotter desk. Describe what happened and SafeComm recommends one; an official decides.',
    tl: 'Ang VAWC desk ay para sa karahasan o pang-aabuso sa babae o sa kanyang anak, halimbawa ng asawa, partner o dating partner - kumpidensyal ito. Ang ibang insidente ay sa Blotter desk. Ikuwento ang nangyari at magrerekomenda ang SafeComm; opisyal ang magpapasya.',
  },
  urgent: {
    en: 'If anyone is in danger now, call an emergency hotline first - SafeComm is not an emergency response service. You can file the report afterwards.',
    tl: 'Kung may nasa panganib ngayon, tumawag muna sa emergency hotline - hindi emergency response service ang SafeComm. Puwede mong i-report pagkatapos.',
  },
  other: {
    en: 'I can help with how to report, what to include, which desk, and what happens next. For other questions, an authorized barangay official needs to confirm.',
    tl: 'Matutulungan kita kung paano mag-report, ano ang ilalagay, aling desk, at ano ang susunod. Sa ibang tanong, kailangang kumpirmahin ng opisyal ng barangay.',
  },
};

// ── The AI's answer, checked ────────────────────────────────────────────────

export const GUIDE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reply', 'clarifying_questions', 'checklist', 'destination', 'needs_official_confirmation'],
  properties: {
    reply: { type: 'string' },
    clarifying_questions: { type: 'array', items: { type: 'string' } },
    checklist: { type: 'array', items: { type: 'string' } },
    destination: { type: 'string', enum: [...GUIDE_DESTINATIONS, 'NONE'] },
    needs_official_confirmation: { type: 'boolean' },
  },
} as const;

export interface GuideAi { reply: string; clarifying_questions: string[]; checklist: string[]; destination: GuideDestination | 'NONE'; needs_official_confirmation: boolean }

const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|ph|gov|org|net)\b/i;
const PHONE_RE = /(?:\+?63|\b0)?[\s-]?\(?\d{2,4}\)?[\s-]?\d{3}[\s-]?\d{3,4}\b|\b(911|117|112|8888)\b/g;
/** Promises and claims the assistant may never make. */
const FORBIDDEN = /guarantee|garantisado|will (definitely|surely|certainly) be (accepted|approved|resolved)|siguradong (tatanggapin|maaaprubahan|mananalo)|you will win|mananalo ka|is guilty|(we|i) (have )?(already )?(contacted|notified|called|alerted|informed) (the )?(police|pnp|authorities|barangay|officials?)|(police|authorities) (have been|are being) (notified|contacted|sent)|(na-?contact|natawagan|naipaalam|na-?notify) na (namin|ko)|i (have )?(filed|submitted) (your|the) report|naisumite ko na/i;
const digits = (s: string) => s.replace(/\D/g, '');
const ALLOWED_NUMBERS = new Set(EMERGENCY_HOTLINES.flatMap(h => h.numbers.map(digits)));

/** Why an AI text may not be shown, or null when it may. */
export function guideTextProblem(text: string): string | null {
  if (URL_RE.test(text)) return 'link';
  if (FORBIDDEN.test(text)) return 'promise_or_claim';
  for (const m of text.match(PHONE_RE) ?? []) {
    const d = digits(m);
    if (d.length >= 7 && !ALLOWED_NUMBERS.has(d)) return 'unknown_number';
    if (d.length < 7 && d.length >= 3) return 'unknown_number';
  }
  return null;
}

const strList = (v: unknown, max: number, each = 220) => Array.isArray(v)
  ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim().slice(0, each)).slice(0, max) : null;

/** The AI's answer, checked: every field of its kind, nothing promised, no link, no number that is not a configured hotline. null otherwise. */
export function validateGuide(raw: unknown): GuideAi | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.reply !== 'string' || !r.reply.trim() || r.reply.length > 1500) return null;
  const qs = strList(r.clarifying_questions, 3), cl = strList(r.checklist, 6);
  if (!qs || !cl || typeof r.needs_official_confirmation !== 'boolean') return null;
  if (![...GUIDE_DESTINATIONS, 'NONE'].includes(r.destination as string)) return null;
  if ([r.reply, ...qs, ...cl].some(t => guideTextProblem(t as string))) return null;
  return { reply: r.reply.trim(), clarifying_questions: qs, checklist: cl, destination: r.destination as GuideAi['destination'], needs_official_confirmation: r.needs_official_confirmation };
}

// ── The organized description, checked ─────────────────────────────────────

export const ORGANIZE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['organized', 'confirmed', 'uncertain', 'missing'],
  properties: {
    organized: { type: 'string' },
    confirmed: { type: 'array', items: { type: 'string' } },
    uncertain: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface Organized { organized: string; confirmed: string[]; uncertain: string[]; missing: string[] }

const PLACEHOLDER = /\[(pangalan|numero|email)\]/gi;
const COMMON = new Set(('the a an i we he she they it my our his her their this that on at in of to and or but if when then after before during while there ' +
  'si ni sina nina ang ng sa mga ako kami kita siya sila ito iyon noong nang kaya pero at o kung ay may wala hindi oo po opo ' +
  'monday tuesday wednesday thursday friday saturday sunday lunes martes miyerkules huwebes biyernes sabado linggo january february march april may june july august september october november december ' +
  'enero pebrero marso abril mayo hunyo hulyo agosto setyembre oktubre nobyembre disyembre barangay brgy purok street st kalye sitio bocaue bulacan').split(/\s+/));
const words = (s: string) => s.toLowerCase().replace(PLACEHOLDER, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]+/g) ?? [];

/**
 * What the organized text says that the resident did not: a number, or a
 * capitalised word (a name, a place) that is not in their description. The
 * organizer may reword and reorder - never add a person, a place, a date or
 * an amount.
 */
export function unsupportedContent(original: string, text: string): string[] {
  const have = new Set(words(original));
  const origDigits = new Set((original.match(/\d+/g) ?? []));
  const out: string[] = [];
  for (const n of text.match(/\d+/g) ?? []) if (!origDigits.has(n)) out.push(n);
  // Capitalised words not opening a sentence.
  const re = /(?<![.!?:\n]\s{0,3}|^\s{0,3})\b([A-ZÑ][a-zñ]{2,})\b/g;
  for (const m of text.matchAll(re)) {
    const w = words(m[1])[0];
    if (w && !have.has(w) && !COMMON.has(w)) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** The organizer's answer, checked: present, of its kind, not much longer than the original, adding nothing. null otherwise. */
export function validateOrganized(original: string, raw: unknown): Organized | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.organized !== 'string' || r.organized.trim().length < 10) return null;
  const confirmed = strList(r.confirmed, 8), uncertain = strList(r.uncertain, 6), missing = strList(r.missing, 6);
  if (!confirmed || !uncertain || !missing) return null;
  const organized = r.organized.trim();
  if (organized.length > original.length * 1.8 + 300) return null;
  if ([organized, ...confirmed, ...uncertain].some(t => unsupportedContent(original, t).length > 0)) return null;
  if ([organized, ...confirmed, ...uncertain, ...missing].some(t => guideTextProblem(t))) return null;
  return { organized, confirmed, uncertain, missing };
}

// ── Next steps, from the draft itself ───────────────────────────────────────

export interface DraftFacts {
  descriptionWords: number; hasDate: boolean; hasLocationDetails: boolean; relationship: string;
  affectedNamed: boolean; reportedNamed: boolean; organizedOffered: boolean; organizedDecided: boolean; urgent: boolean;
}
export interface Step { key: string; text: Record<GuideLang, string>; tone: 'info' | 'urgent' }

/** Before submitting: only what applies to this draft. */
export function beforeSubmitSteps(d: DraftFacts): Step[] {
  const s: Step[] = [];
  if (d.urgent) s.push({ key: 'urgent', tone: 'urgent', text: { en: 'If anyone is in danger now, call an emergency hotline first. You can submit the report afterwards.', tl: 'Kung may nasa panganib ngayon, tumawag muna sa emergency hotline. Puwede mong i-submit ang report pagkatapos.' } });
  if (d.descriptionWords < 20) s.push({ key: 'more', tone: 'info', text: { en: 'Add a little more about what happened, if you can - only what you know.', tl: 'Magdagdag ng kaunti pa tungkol sa nangyari kung kaya mo - ang alam mo lang.' } });
  if (!d.hasDate) s.push({ key: 'date', tone: 'info', text: { en: 'If you know roughly when it happened, add the date - or leave it blank.', tl: 'Kung alam mo kung kailan, ilagay ang petsa - o iwanang blangko.' } });
  if (!d.hasLocationDetails) s.push({ key: 'place', tone: 'info', text: { en: 'A landmark near the place helps officials find it.', tl: 'Makakatulong ang palatandaan malapit sa lugar.' } });
  if ((d.relationship === 'THIRD_PARTY' || d.relationship === 'ON_BEHALF') && !d.affectedNamed) {
    s.push({ key: 'affected', tone: 'info', text: { en: 'You are reporting for someone else: add the person affected, if you know who they are.', tl: 'Para sa iba ang report: idagdag ang taong naapektuhan kung kilala mo.' } });
  }
  if (!d.reportedNamed) s.push({ key: 'reported', tone: 'info', text: { en: 'Add who was involved, if you know and it is safe to say.', tl: 'Idagdag kung sino ang sangkot, kung alam mo at ligtas sabihin.' } });
  if (d.organizedOffered && !d.organizedDecided) s.push({ key: 'organized', tone: 'info', text: { en: 'Review the AI-organized description: use it, edit it, or keep your own.', tl: 'Suriin ang inayos na paglalarawan: gamitin, i-edit, o panatilihin ang sa iyo.' } });
  return s;
}

/** After submitting: what applies to this report. */
export function afterSubmitSteps(a: { caseNumber: string; questionsAsked: boolean; urgent: boolean; confidential: boolean }): Step[] {
  const s: Step[] = [];
  if (a.urgent) s.push({ key: 'urgent', tone: 'urgent', text: { en: 'If anyone is still in danger, call an emergency hotline now - SafeComm is not an emergency response service.', tl: 'Kung may nasa panganib pa rin, tumawag na sa emergency hotline - hindi emergency response service ang SafeComm.' } });
  s.push({ key: 'reference', tone: 'info', text: { en: `Save your case reference: ${a.caseNumber}.`, tl: `I-save ang iyong case reference: ${a.caseNumber}.` } });
  s.push({ key: 'track', tone: 'info', text: { en: 'Follow its progress in My Cases, and watch Notifications for updates from officials.', tl: 'Sundan ang progreso sa My Cases, at bantayan ang Notifications para sa mga update.' } });
  if (a.questionsAsked) s.push({ key: 'answer', tone: 'info', text: { en: 'The barangay may ask you a few questions - answer them in My Cases when you can.', tl: 'Maaaring magtanong ang barangay - sagutin sa My Cases kapag kaya mo.' } });
  s.push({ key: 'hearings', tone: 'info', text: { en: 'Any hearing or notice appears in My Hearings & Notices.', tl: 'Ang anumang hearing o abiso ay lalabas sa My Hearings & Notices.' } });
  if (a.confidential) s.push({ key: 'private', tone: 'info', text: { en: 'Your report is confidential: only the officers assigned to it can see it.', tl: 'Kumpidensyal ang iyong report: ang mga nakatalagang opisyal lang ang makakakita.' } });
  return s;
}
