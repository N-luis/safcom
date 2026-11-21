/**
 * What SafeComm's AI is told about the jurisdiction - one instruction block,
 * built from the configured jurisdiction (never typed into a prompt by hand),
 * appended to every Groq call that reads a report, runs the intake interview
 * or helps with an address.
 *
 * This does not train or change the model: the rules are sent with each
 * request. And the AI never decides - the server's checks (lib/jurisdiction.ts)
 * decide residency, report acceptance and referral; the AI may only explain
 * them and ask the resident to clarify.
 */
import { DEFAULT_JURISDICTION, type JurisdictionConfig } from './jurisdiction';

/** The jurisdiction the AI is told about: the last one loaded from the database, or the defaults. */
let active: JurisdictionConfig = DEFAULT_JURISDICTION;
export const setActiveJurisdiction = (cfg: JurisdictionConfig) => { active = cfg; };
export const activeJurisdiction = () => active;

export function jurisdictionPromptBlock(cfg: JurisdictionConfig = active): string {
  return [
    'SAFECOMM JURISDICTION (from the system configuration - do not change or add to it):',
    `- SafeComm serves verified residents of Barangay ${cfg.barangay}, ${cfg.municipality}, ${cfg.province}${cfg.barangayAliases.length ? ` (also written: ${cfg.barangayAliases.join(', ')})` : ''}.`,
    `- Official boundary: ${cfg.boundary ? 'configured; the server checks map locations against it' : 'not configured; map locations are checked by a person'}.`,
    '- A person\'s residential address and an incident\'s location are different things. Never assume the home address is where the incident happened.',
    '- Never invent, correct or guess a barangay, street, address or boundary. If a place is unclear, ask the person to clarify it.',
    '- Residency is never proven by a written statement, a Google/Gmail sign-in, or a device being in the barangay. You never approve or reject a resident account.',
    '- Whether a location is inside the jurisdiction, and whether a report is accepted, is decided by the server\'s checks. Never override them; when told the result, explain it.',
    '- An incident outside the jurisdiction is referred to the barangay or authority where it happened; an urgent danger is told to contact emergency services at once.',
  ].join('\n');
}

/** For the address assistant: explain the server's result - and only that. */
export const ADDRESS_ASSIST_PROMPT = [
  'You help residents of a Philippine barangay complete an address or an incident location in SafeComm.',
  'You are given the SERVER RESULT of SafeComm\'s address check. It is final: never change a status, a match, a destination or whether human review is needed.',
  'Write a short explanation of that result for the resident (Filipino first, then English in parentheses), and up to three short clarifying questions about what is missing or ambiguous.',
  'Never propose a corrected address, street, barangay or coordinates of your own; you may only repeat the suggestions the server lists.',
].join('\n');

export const ADDRESS_ASSIST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['explanation', 'clarifying_questions'],
  properties: {
    explanation: { type: 'string' },
    clarifying_questions: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Whether the AI's wording agrees with the server's result: an explanation of
 * an outside location must say so, and one of an inside location must not
 * say it is outside. Anything else is not used (the server's wording stands).
 */
export function explanationAgrees(status: string, text: string): boolean {
  const t = text.toLowerCase();
  const saysOutside = /labas ng sakop|nasa labas|outside (of )?(safecomm|the (jurisdiction|barangay|coverage))|not within|hindi sakop/.test(t);
  if (status === 'OUTSIDE') return saysOutside;
  return !saysOutside && !/\b(approved|aprubado|na-verify na ang (inyong )?(account|residency))\b/.test(t);
}
