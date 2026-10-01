/**
 * The recommendation, in the language the resident wrote their report in.
 *
 * Two things live here. The instruction a vision or text model is given, kept
 * next to the wording it governs so the two cannot drift apart; and the
 * recommendation text itself, which is what the resident reads today, because
 * nothing calls a model yet. When one is wired in, the instruction below is
 * what it is told, and these strings remain as the fallback for a provider
 * that is unreachable - a resident who gets no answer is worse served than one
 * who gets a careful fixed answer in their own language.
 *
 * Every string is written out per language rather than machine-translated at
 * request time: this is text a barangay puts its name to, and a translation
 * nobody read is not something to hand someone who has just reported being
 * hurt.
 */

import type { ReportLanguage } from './detectLanguage';

/**
 * The line added to a model prompt. Worded as the specification sets it, so
 * what the model is asked for can be checked without reading provider code.
 */
export const RECOMMENDATION_LANGUAGE_INSTRUCTION: Record<ReportLanguage, string> = {
  tagalog: 'Write the entire recommendation in Tagalog.',
  taglish:
    'Write the entire recommendation in Taglish (natural mix of Tagalog and English, '
    + 'the way Filipinos talk).',
  english: 'Write the entire recommendation in pure English. Do not use Tagalog words.',
};

/** Shown beside the recommendation so an officer knows which it is. */
export const LANGUAGE_LABEL: Record<ReportLanguage, string> = {
  tagalog: 'Tagalog',
  taglish: 'Taglish',
  english: 'English',
};

/**
 * The prompt a model is given when one is wired in.
 *
 * It states the two parts, the tone, and the standing limits the rest of the
 * system is held to: no claim that anyone has acted, no finding of fault, no
 * legal advice.
 */
export function buildRecommendationPrompt(input: {
  language: ReportLanguage;
  caseType: string;
  description: string;
  priority: string;
}): string {
  return `You are helping a Philippine barangay respond to a resident's report.

${RECOMMENDATION_LANGUAGE_INSTRUCTION[input.language]}

Write two parts:
1. RECOMMENDED ACTION - what the barangay should do first about this report.
2. MESSAGE TO THE RESIDENT - in the barangay's own voice, telling them what to
   do while they wait.

Tone: calm, respectful and reassuring. In Tagalog and Taglish use "po" and
"opo" where they belong.

Rules:
- Use only what the report says. Never add a detail it does not contain.
- Do not say the barangay, the police or anyone else has already acted. Nothing
  has happened yet beyond the report being received.
- Do not decide who is at fault. Do not give legal or medical advice.
- Do not name a risk level.

CASE TYPE: ${input.caseType}
ASSESSED PRIORITY: ${input.priority}
REPORT: ${input.description}`;
}

// ─── The recommendation text ─────────────────────────────────────────────────

/**
 * The barangay's message to the resident.
 *
 * The Tagalog is the wording the barangay asked for; the other two carry the
 * same meaning and the same tone rather than being a word-for-word rendering.
 */
export const BARANGAY_MESSAGE: Record<ReportLanguage, string> = {
  tagalog:
    'Kalma lang po muna. Natanggap na po ng barangay ang inyong report, at ang barangay '
    + 'po ay humihingi ng dispensa sa aberya na inyong kinalalagyan.',
  taglish:
    'Kalma lang po muna. Na-receive na po ng barangay ang inyong report, and humihingi '
    + 'po kami ng dispensa sa aberya na inyong kinalalagyan.',
  english:
    'Please stay calm. The barangay has received your report, and we are sorry for the '
    + 'trouble you are dealing with.',
};

/** Every fixed line a recommendation can carry. */
export type RecommendationKey =
  | 'emergencyNow' | 'emergencyLater'
  | 'keepEvidence' | 'avoidConfrontation' | 'moveSafer' | 'injurySeen'
  | 'stalkingStayElsewhere' | 'keepPhoneReachable' | 'writeWithheld'
  | 'writeEarlierIncidents' | 'keepCaseNumberUrgent' | 'keepCaseNumber'
  | 'officerRetaliation' | 'officerVulnerable'
  | 'triageOnly' | 'notFault' | 'safetyFirst' | 'updateIfAgain';

/**
 * Written out per language. A missing translation is a type error here rather
 * than an English sentence appearing in a Tagalog recommendation.
 */
export const RECOMMENDATION_TEXT: Record<RecommendationKey, Record<ReportLanguage, string>> = {
  emergencyNow: {
    english:
      'If you are in danger right now, contact the emergency numbers below before anything '
      + 'else. Do not wait for this case to be reviewed.',
    tagalog:
      'Kung nasa panganib po kayo ngayon, tawagan po ninyo ang mga numero sa ibaba bago ang '
      + 'anupaman. Huwag po kayong maghintay na masuri ang kasong ito.',
    taglish:
      'Kung nasa danger po kayo ngayon, contact po ninyo yung mga emergency number sa ibaba '
      + 'bago ang kahit ano. Huwag po kayong maghintay na ma-review ang case na ito.',
  },
  emergencyLater: {
    english:
      'If the situation becomes dangerous, contact the emergency numbers below rather than '
      + 'waiting for case processing.',
    tagalog:
      'Kung po ay maging delikado ang sitwasyon, tawagan po ninyo ang mga numero sa ibaba sa '
      + 'halip na maghintay sa proseso ng kaso.',
    taglish:
      'Kung maging delikado po yung sitwasyon, contact po ninyo yung emergency numbers sa '
      + 'ibaba imbes na maghintay sa processing ng case.',
  },
  keepEvidence: {
    english:
      'Keep anything that records what happened - messages, screenshots, photographs, '
      + 'receipts, medical or barangay documents.',
    tagalog:
      'Itago po ninyo ang anumang nagpapatunay sa nangyari - mga mensahe, screenshot, '
      + 'litrato, resibo, at mga dokumentong medikal o mula sa barangay.',
    taglish:
      'Keep po ninyo lahat ng makakapagpatunay sa nangyari - messages, screenshots, pictures, '
      + 'resibo, at medical o barangay documents.',
  },
  avoidConfrontation: {
    english:
      'Avoid confronting the person involved directly if that could make the situation worse.',
    tagalog:
      'Iwasan po ninyong harapin nang tuwiran ang taong sangkot kung maaari nitong palalain '
      + 'ang sitwasyon.',
    taglish:
      'Iwasan po ninyong i-confront nang direkta yung taong involved kung baka lumala pa po '
      + 'ang sitwasyon.',
  },
  moveSafer: {
    english:
      'Move somewhere safer if you can do so safely, and tell someone you trust where you are.',
    tagalog:
      'Kung kaya po ninyong lumipat sa mas ligtas na lugar, gawin po ninyo, at sabihin po '
      + 'ninyo sa taong pinagkakatiwalaan ninyo kung nasaan kayo.',
    taglish:
      'Kung pwede po kayong lumipat sa mas safe na lugar, gawin po ninyo, and sabihin po ninyo '
      + 'sa taong trusted ninyo kung nasaan kayo.',
  },
  injurySeen: {
    english: 'Have any injury seen to, and keep the record of that visit.',
    tagalog:
      'Ipatingin po ninyo ang anumang sugat o sakit, at itago po ninyo ang rekord ng '
      + 'pagpapatingin.',
    taglish: 'Ipa-check po ninyo yung injury, and keep po ninyo yung record ng check-up.',
  },
  stalkingStayElsewhere: {
    english:
      'The report mentions being followed or the person knowing where you stay. Consider '
      + 'staying somewhere they do not for now.',
    tagalog:
      'Nabanggit po sa inyong ulat na kayo ay sinusundan o alam ng tao kung saan kayo '
      + 'nakatira. Maaari po muna kayong tumuloy sa lugar na hindi niya alam.',
    taglish:
      'Nabanggit po sa report na may sumusunod sa inyo o alam po niya kung saan kayo nakatira. '
      + 'Baka mas mabuti pong mag-stay muna kayo sa place na hindi niya alam.',
  },
  keepPhoneReachable: {
    english:
      'Keep a charged phone within reach, and let a neighbour know they may need to call for help.',
    tagalog:
      'Ilapit po ninyo ang naka-charge na telepono, at ipaalam po ninyo sa kapitbahay na baka '
      + 'kailanganin nilang tumawag ng tulong.',
    taglish:
      'Keep po ninyong naka-charge yung phone ninyo, at sabihan po ninyo yung kapitbahay baka '
      + 'kailangan nilang tumawag ng tulong.',
  },
  writeWithheld: {
    english:
      'Write down which documents or money are being withheld so the officer has it on record.',
    tagalog:
      'Isulat po ninyo kung anong mga dokumento o pera ang hindi ibinibigay sa inyo upang '
      + 'maitala ito ng opisyal.',
    taglish:
      'Isulat po ninyo kung anong documents o pera yung hindi ibinibigay sa inyo para ma-record '
      + 'po ito ng officer.',
  },
  writeEarlierIncidents: {
    english:
      'Write down the earlier incidents with dates if you can remember them, and add them to '
      + 'this case.',
    tagalog:
      'Isulat po ninyo ang mga naunang pangyayari pati ang petsa kung natatandaan ninyo, at '
      + 'idagdag po ito sa kasong ito.',
    taglish:
      'Isulat po ninyo yung mga naunang incident pati dates kung natatandaan ninyo, and i-add '
      + 'po ito sa case na ito.',
  },
  keepCaseNumberUrgent: {
    english: 'Keep your case number for reference.',
    tagalog: 'Itago po ninyo ang inyong case number para sa sanggunian.',
    taglish: 'Keep po ninyo yung case number ninyo for reference.',
  },
  keepCaseNumber: {
    english:
      'Keep your case number and follow the case under My Cases. Add anything further if an '
      + 'officer asks.',
    tagalog:
      'Itago po ninyo ang inyong case number at sundan po ninyo ang kaso sa ilalim ng My '
      + 'Cases. Magdagdag po kayo ng impormasyon kung hihingin ng opisyal.',
    taglish:
      'Keep po ninyo yung case number at i-follow po ninyo sa My Cases. Mag-add po kayo ng info '
      + 'kung may hihingin pa po yung officer.',
  },
  officerRetaliation: {
    english:
      'A threat of reprisal for reporting is described - handle the reporter’s details '
      + 'accordingly.',
    tagalog:
      'May nabanggit pong banta ng paghihiganti dahil sa pagrereklamo - ingatan po ang detalye '
      + 'ng nagreklamo.',
    taglish:
      'May na-describe pong threat ng paghihiganti dahil sa pag-report - i-handle po nang '
      + 'maingat ang details ng nag-report.',
  },
  officerVulnerable: {
    english:
      'A minor or dependent person is described - consider a VAWC or child-protection referral.',
    tagalog:
      'May nabanggit pong menor de edad o taong umaasa sa iba - maaari pong isaalang-alang ang '
      + 'referral sa VAWC o child protection.',
    taglish:
      'May na-describe pong minor o dependent na tao - pwede po nating i-consider ang VAWC o '
      + 'child protection referral.',
  },
  triageOnly: {
    english:
      'This assessment is produced from the words in your report. It assists triage only and '
      + 'does not replace a review by an authorized officer.',
    tagalog:
      'Ang pagsusuring ito ay nagmula lamang sa mga salitang nasa inyong ulat. Pantulong po ito '
      + 'sa triage at hindi po kapalit ng pagsusuri ng awtorisadong opisyal.',
    taglish:
      'Ang assessment pong ito ay galing lang sa mga salitang nasa report ninyo. Pantulong lang '
      + 'po ito sa triage at hindi po kapalit ng review ng authorized officer.',
  },
  notFault: {
    english: 'It does not decide who is at fault, and it is not legal or medical advice.',
    tagalog:
      'Hindi po nito tinutukoy kung sino ang may kasalanan, at hindi po ito legal o medikal na '
      + 'payo.',
    taglish:
      'Hindi po nito dini-decide kung sino ang may kasalanan, at hindi po ito legal o medical '
      + 'advice.',
  },
  safetyFirst: {
    english: 'Your safety comes before this case. If you are in danger, get help first.',
    tagalog:
      'Ang kaligtasan po ninyo ang mas mahalaga kaysa sa kasong ito. Kung nasa panganib po '
      + 'kayo, humingi po muna kayo ng tulong.',
    taglish:
      'Ang safety po ninyo ang mas importante kaysa sa case na ito. Kung nasa danger po kayo, '
      + 'humingi po muna kayo ng tulong.',
  },
  updateIfAgain: {
    english:
      'If the situation happens again or changes, update the case so the officer sees the pattern.',
    tagalog:
      'Kung mauulit po o magbago ang sitwasyon, i-update po ninyo ang kaso upang makita ng '
      + 'opisyal ang pattern.',
    taglish:
      'Kung mauulit po o magbago yung sitwasyon, i-update po ninyo ang case para makita po ng '
      + 'officer ang pattern.',
  },
};

/** One fixed line, in the detected language. */
export const say = (key: RecommendationKey, language: ReportLanguage): string =>
  RECOMMENDATION_TEXT[key][language];

// ─── Lines that carry an assessed value ──────────────────────────────────────
// The value itself stays in its canonical form: it is the same label the
// officer sees on the case list and in the filters, and translating it in one
// place only would make the two look like different things.

export const officerRepeated = (language: ReportLanguage, recurrence: string): string => ({
  english: `Repeated incidents identified - recurrence assessed as ${recurrence}.`,
  tagalog: `May natukoy pong paulit-ulit na pangyayari - ang recurrence ay nasuri bilang ${recurrence}.`,
  taglish: `May na-identify pong repeated incidents - ang recurrence po ay na-assess bilang ${recurrence}.`,
}[language]);

export const officerEscalation = (language: ReportLanguage, escalation: string): string => ({
  english: `Escalation potential assessed as ${escalation} - coordinate with the reporter promptly.`,
  tagalog: `Ang posibilidad ng paglala ay nasuri bilang ${escalation} - makipag-ugnayan po agad sa nagreklamo.`,
  taglish: `Ang escalation potential po ay na-assess bilang ${escalation} - please coordinate po agad sa nag-report.`,
}[language]);

export const officerPriority = (language: ReportLanguage, urgency: string): string => ({
  english: `Case priority assessed as ${urgency}. This has not been reviewed by anyone yet.`,
  tagalog: `Ang prayoridad ng kaso ay nasuri bilang ${urgency}. Wala pa pong nakakasuri nito.`,
  taglish: `Ang case priority po ay na-assess bilang ${urgency}. Wala pa pong nagre-review nito.`,
}[language]);
