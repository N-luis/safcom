/**
 * Which language a resident wrote their report in, so the recommendation can
 * answer in the same one.
 *
 * Offline and rule-based on purpose. A statistical identifier needs more text
 * than a barangay report usually carries, and the common case here - a Tagalog
 * sentence holding two English nouns - is exactly what those libraries get
 * wrong, because the English nouns are the words they weight most.
 *
 * This is a different axis from lib/i18n.ts. That file holds the interface
 * language the resident chose from a toggle; this reads the language they
 * actually typed in, which is often not the same, and has a third value for
 * the mixture most people write.
 */

export type ReportLanguage = 'tagalog' | 'taglish' | 'english';

export interface LanguageDetection {
  language: ReportLanguage;
  /** 0-1. How much of the text was recognised, and how clear the call was. */
  confidence: number;
  tagalogCount: number;
  englishCount: number;
}

// ─── Thresholds ──────────────────────────────────────────────────────────────
// Kept together and named so they can be tuned from one place.

/** At or above this share of recognised words, the text is Tagalog. */
export const TAGALOG_RATIO_THRESHOLD = 0.70;

/** At or below this share, the text is English. */
export const ENGLISH_RATIO_THRESHOLD = 0.25;

/**
 * How many words of the OTHER language make a text a mixture regardless of the
 * ratio.
 *
 * "Sir sira po yung street light dito sa Purok 3" is nine parts Tagalog to two
 * parts English, which the ratio alone calls Tagalog - and a recommendation
 * written in full Tagalog would then come back to someone who was already
 * reaching for English words. Two words of the minority language is the point
 * where answering in the mixture reads as natural rather than as a mistake.
 */
export const MIXED_MIN_WORDS = 2;

/** Below this many recognised words, no reading is treated as confident. */
export const MIN_CONFIDENT_WORDS = 4;

// ─── Word lists ──────────────────────────────────────────────────────────────

/**
 * Tagalog: function words first, because they are what a sentence cannot avoid,
 * then the vocabulary barangay reports actually use.
 */
const TAGALOG = `
ang mga ng nang sa na ay po opo ako ikaw siya kami kayo sila ko mo niya namin natin
ninyo nila akin iyo kanya amin atin inyo kanila ito iyan iyon yun yung nung dito
diyan doon rito riyan roon dahil kasi pero ngunit subalit kung kapag habang bago
pagkatapos tapos saka din rin daw raw ba naman lang lamang talaga sana siguro baka
muna pala nga ganun ganoon ganito paano bakit saan sino ano alin kailan ilan marami
konti lahat iba bawat sarili kaya para tungkol ukol

hindi wala walang may mayroon meron huwag wag ayaw gusto kailangan pwede puwede dapat
mahirap madali oo hindi-po

nangyari nakita narinig sinabi sabi ginawa pumunta umalis dumating tumawag tinawagan
humihingi hinihingi nagrereklamo reklamo tulong tumulong tinulungan bigay binigay
kuha kinuha dala dinala galit nagalit takot natakot iyak umiyak nagtatago tumakbo
sumigaw sigaw nagsumbong sumbong

baha binaha pagbaha kanal barado ilaw poste kuryente tubig ingay maingay away nakaw
ninakaw magnanakaw basura kalsada daan kalye eskinita bahay bakod aso pusa hayop bata
matanda kapitbahay kapitan tanod sunog nasunog aksidente nabangga banggaan sugat
nasugatan sakit masakit ospital gamot pulis sira nasira sinira bagsak bumagsak lubak
butas amoy mabaho usok droga sugal inom lasing nanghihingi nambabastos bastos hipo
hinipuan saksak sinaksak baril binaril suntok sinuntok sampal sinampal bugbog binugbog
patay namatay nawawala hanap hinahanap gulo nanggulo pasaway

gabi umaga hapon tanghali madaling-araw kagabi kahapon ngayon bukas araw oras linggo
buwan taon palagi lagi madalas minsan paulit-ulit kanina mamaya

paki pakiusap pakiayos pakitulong pakibigyan pakicheck salamat dispensa pasensya
patawad mabuti maayos ayos maganda masama delikado ligtas malaki maliit mabilis
mabagal marumi malinis sobra sobrang grabe parang mukhang kinalalagyan aberya problema
usapin kaso asawa anak kapatid nanay tatay lolo lola kamag-anak
`;

/**
 * English: stopwords, because they carry the grammar, plus the nouns and verbs
 * that turn up in complaints.
 */
const ENGLISH = `
the a an is are was were be been being am i you he she it we they me him her us them
my your his their our its this that these those there here what which who whom when
where why how all any both each few more most other some such no nor not only own
same so than too very can will just should now and but or if because as until while
of by for with about against between into through during before after above below to
from up down in out on off over under again further then once

do does did doing have has had having would could shall might must please help need
want like get got make made take took see saw know knew think thought say said tell
told ask asked call called come came happen happened

report reported complaint incident problem issue broken break damage damaged flood
flooded flooding garbage trash waste street lights light lamp post noise noisy loud
fight fighting theft stolen steal robbery near beside front back house home road alley
drainage canal clogged water electricity power fire accident injured injury hurt blood
hospital police neighbor neighbour child children kid old man woman dog cat animal

night morning afternoon evening today yesterday tomorrow day time week month year
always often sometimes dangerous safe sorry thank thanks drunk drugs gambling knife
gun hit punch slap threat threatened harassment missing lost find found fix repair
clean remove check send urgent immediately already still yet also

bang sang song long king ring sing thing things young doing going during nothing
something everything anything building parking working walking running coming being
wrong strong along bring hang
`;

/**
 * Counted for neither side.
 *
 * Two kinds of word end up here: honorifics and place words that a Filipino
 * writes in any language ("sir", "barangay", "purok"), and true collisions like
 * "at", which is both the Tagalog word for "and" and an English preposition.
 * Letting either one score would make the honorific decide the language.
 */
const NEUTRAL = `
at sir maam mam boss kuya ate manong manang barangay brgy purok blk block lot subd
subdivision village compound city municipality philippines ok okay yes hi hello
am pm cctv text sms id no. nos
`;

const toSet = (raw: string) => new Set(raw.split(/\s+/).map(w => w.trim()).filter(Boolean));

const TAGALOG_WORDS = toSet(TAGALOG);
const ENGLISH_WORDS = toSet(ENGLISH);
const NEUTRAL_WORDS = toSet(NEUTRAL);

// ─── Affixes ─────────────────────────────────────────────────────────────────
// Tagalog inflects far more than English does, so a word list alone would miss
// most verbs in a real report. Longest first, so "nakaka" is tried before "na".

const PREFIXES = [
  'pinaka', 'nakaka', 'ipinag', 'napaka', 'makiki', 'nagpa', 'pinag', 'sina', 'bina',
  'naka', 'nang', 'mang', 'pang', 'paki', 'ipag', 'pina', 'nagka', 'magka',
  'nag', 'mag', 'pag', 'man', 'ma', 'na', 'ka', 'ni', 'i',
];

const SUFFIXES = ['han', 'hin', 'ang', 'ng', 'an', 'in', 'g'];

/** A root has to be a real word, not two letters left over from stripping. */
const MIN_ROOT_LENGTH = 3;

/**
 * The linker -ng is the exception to that floor.
 *
 * It attaches to any vowel-final word - "po" becomes "pong", "bata" becomes
 * "batang" - so the particles it lands on are often two letters, and they are
 * the strongest Tagalog signals there are. Listing the forms instead is not an
 * option: the linker is productive, so the list would never be finished.
 */
const LINKER = 'ng';
const MIN_LINKED_ROOT_LENGTH = 2;

/**
 * Candidate roots for a word, in the order they are worth trying.
 *
 * Deliberately conservative: one prefix and one suffix at most, and every
 * candidate still has to appear in the Tagalog list to count. Without the
 * length floor, "pain" loses its "in" and becomes the Tagalog particle "pa".
 */
function rootCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => { if (w.length >= MIN_ROOT_LENGTH) out.push(w); };

  // "araw-araw", "sira-sira": each half is the word itself.
  if (word.includes('-')) word.split('-').forEach(add);

  const prefix = PREFIXES.find(p => word.startsWith(p) && word.length - p.length >= MIN_ROOT_LENGTH);
  const suffix = SUFFIXES.find(s => word.endsWith(s) && word.length - s.length >= MIN_ROOT_LENGTH);

  if (prefix) add(word.slice(prefix.length));
  if (suffix) add(word.slice(0, -suffix.length));

  // "pong" -> "po". Allowed below the floor because the linker, unlike the
  // other suffixes, cannot produce a fragment: what is left is a whole word.
  if (word.endsWith(LINKER) && word.length - LINKER.length >= MIN_LINKED_ROOT_LENGTH) {
    const linked = word.slice(0, -LINKER.length);
    if (TAGALOG_WORDS.has(linked)) out.push(linked);
  }
  if (prefix && suffix && word.length - prefix.length - suffix.length >= MIN_ROOT_LENGTH) {
    add(word.slice(prefix.length, -suffix.length));
  }

  // The -in- and -um- infixes sit after the first consonant: "binaha" is
  // "baha", "sumigaw" is "sigaw". No prefix rule reaches these.
  if (/^[^aeiou](in|um)/.test(word)) add(word[0] + word.slice(3));

  // CV reduplication marks aspect: "babaha" is "baha", "sisira" is "sira".
  const redup = /^([^aeiou][aeiou])\1/.exec(word);
  if (redup) add(word.slice(2));

  // Reduplication often sits under a prefix: "nagbabaha" -> "babaha" -> "baha".
  if (prefix) {
    const stem = word.slice(prefix.length);
    const inner = /^([^aeiou][aeiou])\1/.exec(stem);
    if (inner) add(stem.slice(2));
  }

  return out;
}

/** True when the word is Tagalog once its affixes are accounted for. */
function isTagalogByAffix(word: string): boolean {
  return rootCandidates(word).some(r => TAGALOG_WORDS.has(r));
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Lowercased, stripped of punctuation and digits, split into words.
 *
 * Case is removed before anything else, so a report typed in capitals - which
 * residents do write - is read as the language it is in rather than as
 * unreadable.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Hyphens survive: "araw-araw" and "madaling-araw" are single words.
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s]+/)
    .map(w => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reads the language of a report.
 *
 * Returns "english" for anything it cannot read - empty text, a name, a house
 * number - because that is the language the rest of the system is written in,
 * so an unknown falls back to something rather than to nothing.
 */
export function detectLanguage(text: string): LanguageDetection {
  const none: LanguageDetection = {
    language: 'english', confidence: 0, tagalogCount: 0, englishCount: 0,
  };
  if (typeof text !== 'string' || !text.trim()) return none;

  const tokens = tokenize(text);
  if (!tokens.length) return none;

  let tagalogCount = 0;
  let englishCount = 0;

  for (const word of tokens) {
    // Neutral first: an honorific or a place name must not tip the count,
    // whichever list it might also appear in.
    if (NEUTRAL_WORDS.has(word)) continue;
    if (TAGALOG_WORDS.has(word)) { tagalogCount++; continue; }
    if (ENGLISH_WORDS.has(word)) { englishCount++; continue; }
    // Only now is it worth taking a word apart. Checking the English list
    // first keeps an English word from being read as an inflected Tagalog one.
    if (isTagalogByAffix(word)) { tagalogCount++; continue; }
    // Anything else - a name, a street, a misspelling - is left out.
  }

  const recognised = tagalogCount + englishCount;
  if (recognised === 0) return { ...none, tagalogCount, englishCount };

  const ratio = tagalogCount / recognised;

  // Both languages genuinely present is a mixture, whatever the ratio says.
  const mixed = tagalogCount >= MIXED_MIN_WORDS && englishCount >= MIXED_MIN_WORDS;

  const language: ReportLanguage = mixed
    ? 'taglish'
    : ratio >= TAGALOG_RATIO_THRESHOLD ? 'tagalog'
      : ratio <= ENGLISH_RATIO_THRESHOLD ? 'english'
        : 'taglish';

  // Confidence is how much of the text was recognised, scaled by how clear the
  // call was: a decisive ratio for the single-language readings, a balanced one
  // for a mixture. Short reports are capped, because four words cannot settle
  // this however one-sided they look.
  const coverage = recognised / tokens.length;
  const margin = language === 'taglish'
    ? 1 - Math.abs(0.5 - ratio) * 2
    : Math.abs(ratio - 0.5) * 2;
  let confidence = coverage * (0.5 + margin / 2);
  if (recognised < MIN_CONFIDENT_WORDS) confidence = Math.min(confidence, 0.5);

  return {
    language,
    confidence: round2(Math.max(0, Math.min(1, confidence))),
    tagalogCount,
    englishCount,
  };
}

/** Never throws. Falls back to English and says so, for use on a request path. */
export function detectLanguageSafe(text: string): LanguageDetection {
  try {
    return detectLanguage(text);
  } catch (err) {
    console.warn('[detectLanguage] falling back to English:', err);
    return { language: 'english', confidence: 0, tagalogCount: 0, englishCount: 0 };
  }
}
