/**
 * SafeComm's jurisdiction: who may hold a regular resident account, and which
 * incidents are standard SafeComm cases.
 *
 * Pure rules, shared by the routes (which enforce them), the screens (which
 * explain them) and the tests. No database access here - the configured
 * jurisdiction is loaded by lib/jurisdictionServer.ts and passed in.
 *
 * What decides, in order:
 *   1. the address as the resident chose it from the lists - province,
 *      municipality, barangay (compared as names, accents and spacing aside),
 *      then the street against the barangay's own street list;
 *   2. the map pin, against the official boundary polygon - only when an
 *      administrator has configured one. No polygon is guessed: until one is
 *      configured, the pin is never what decides, and the application goes to
 *      a person.
 *
 * Nothing here ever verifies a resident. The best a check can say is that an
 * application may go to a verifier; only a verifier (lib/jurisdictionServer.ts
 * RESIDENCY_VERIFIER_ROLES) marks a resident Verified. A device being inside
 * the barangay, a Google sign-in, or a written statement proves nothing.
 */
import { BARANGAY_STREETS, STREET_ALIASES } from './streets';

// ── The jurisdiction ─────────────────────────────────────────────────────────

/** A GeoJSON Polygon or MultiPolygon, as [longitude, latitude] rings. */
export type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface JurisdictionConfig {
  barangay: string;
  /** Other spellings of the same barangay (e.g. "Binang 2nd", "Biñang II"). */
  barangayAliases: string[];
  municipality: string;
  province: string;
  /** The official boundary, when an administrator has configured one. Null: not configured. */
  boundary: BoundaryGeometry | null;
  /** Where the boundary came from (an office, a survey), as the administrator recorded it. */
  boundarySource: string | null;
}

/**
 * The defaults, used until the jurisdiction is configured in the database.
 * The names come from the deployment settings (the same ones the rest of
 * SafeComm uses); there is deliberately no default boundary.
 */
export const DEFAULT_JURISDICTION: JurisdictionConfig = {
  barangay: process.env.NEXT_PUBLIC_BARANGAY_NAME ?? 'Biñang 2nd',
  barangayAliases: ['Binang 2nd', 'Biñang II', 'Binang II', 'Biñang Ikalawa', 'Binang Ikalawa', 'Biñang 2', 'Binang 2'],
  municipality: process.env.NEXT_PUBLIC_MUNICIPALITY ?? 'Bocaue',
  province: process.env.NEXT_PUBLIC_PROVINCE ?? 'Bulacan',
  boundary: null,
  boundarySource: null,
};

/** The barangays of Bocaue, for the dependent dropdown (anything else is typed). */
export const BOCAUE_BARANGAYS = [
  'Antipona', 'Bagumbayan', 'Bambang', 'Batia', 'Biñang 1st', 'Biñang 2nd', 'Bolacan', 'Bundukan', 'Bunlo', 'Caingin',
  'Duhat', 'Igulot', 'Lolomboy', 'Poblacion', 'Sulucan', 'Taal', 'Tambobong', 'Turo', 'Wakas',
] as const;

/** The cities and municipalities of Bulacan, for the dependent dropdown. */
export const BULACAN_MUNICIPALITIES = [
  'Angat', 'Balagtas', 'Baliwag', 'Bocaue', 'Bulakan', 'Bustos', 'Calumpit', 'Doña Remedios Trinidad', 'Guiguinto', 'Hagonoy',
  'Malolos', 'Marilao', 'Meycauayan', 'Norzagaray', 'Obando', 'Pandi', 'Paombong', 'Plaridel', 'Pulilan', 'San Ildefonso',
  'San Jose del Monte', 'San Miguel', 'San Rafael', 'Santa Maria',
] as const;

/** The barangay's own streets, offered on the form when the jurisdiction's barangay is chosen (any other is typed). */
export const BARANGAY_STREETS_FOR_FORM: readonly string[] = [...BARANGAY_STREETS];

/** The lists the address form offers under a province and a municipality; any other is typed. */
export function municipalitiesFor(province: string): readonly string[] {
  return sameName(province, 'Bulacan') ? BULACAN_MUNICIPALITIES : [];
}
export function barangaysFor(municipality: string): readonly string[] {
  return sameName(municipality, 'Bocaue') ? BOCAUE_BARANGAYS : [];
}

// ── Names ────────────────────────────────────────────────────────────────────

/** A place name as compared: no accents, case, punctuation or spacing; "ii" and "2" read as "2nd". */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(city|municipality|municipio|of|province|barangay|brgy|bgy)\b\.?/g, ' ')
    .replace(/\bii\b/g, '2nd').replace(/\bikalawa\b/g, '2nd').replace(/\bi\b/g, '1st').replace(/\bunang\b/g, '1st')
    .replace(/\b2\b/g, '2nd').replace(/\b1\b/g, '1st')
    .replace(/[^a-z0-9]+/g, '');
}
export const sameName = (a: string | null | undefined, b: string | null | undefined) => normalizeName(a) !== '' && normalizeName(a) === normalizeName(b);

export const isJurisdictionBarangay = (name: string | null | undefined, cfg: JurisdictionConfig) =>
  [cfg.barangay, ...cfg.barangayAliases].some(n => sameName(name, n));

/** Levenshtein distance, for spelling suggestions only - never to change what was typed. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** A street name as compared: the name normalized, with St./Street, Ave./Avenue, Subd./Subdivision and so on read alike. */
const streetKey = (s: string) => normalizeName(s.replace(/\bst\.?(?=\s|$)/gi, 'street').replace(/\bave\.?(?=\s|$)/gi, 'avenue')
  .replace(/\bsubd\.?(?=\s|$)/gi, 'subdivision').replace(/\bcomp\.?(?=\s|$)/gi, 'compound').replace(/\bext\.?(?=\s|$)/gi, 'extension')
  .replace(/\bgov\.?(?=\s|$)/gi, 'governor').replace(/\bhi-?way\b/gi, 'highway'));

/**
 * The street as the barangay's records name it, or suggestions when it is
 * not on them. Never a correction: the resident's own words are kept, and a
 * suggestion is only offered for them to choose.
 */
export function matchStreet(input: string | null | undefined): { input: string; match: string | null; known: boolean; suggestions: string[] } {
  const raw = (input ?? '').trim();
  const known: string[] = [...BARANGAY_STREETS];
  const key = streetKey(raw);
  if (!key) return { input: raw, match: null, known: false, suggestions: [] };
  const alias = Object.entries(STREET_ALIASES).find(([a]) => streetKey(a) === key);
  if (alias) return { input: raw, match: alias[1], known: true, suggestions: [] };
  const exact = known.find(s => streetKey(s) === key);
  if (exact) return { input: raw, match: exact, known: true, suggestions: [] };
  const scored = known.map(s => ({ s, d: editDistance(streetKey(s), key) }))
    .filter(x => x.d <= Math.max(2, Math.floor(streetKey(x.s).length / 4)) || streetKey(x.s).includes(key) || key.includes(streetKey(x.s)))
    .sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.s);
  return { input: raw, match: null, known: false, suggestions: scored };
}

// ── The boundary ─────────────────────────────────────────────────────────────

/** Ray casting on one ring of [lng, lat] points. */
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside a polygon: in its outer ring and in none of its holes. */
const inPolygon = (lng: number, lat: number, rings: number[][][]) => rings.length > 0 && inRing(lng, lat, rings[0]) && !rings.slice(1).some(h => inRing(lng, lat, h));

export function pointInBoundary(lat: number, lng: number, b: BoundaryGeometry): boolean {
  return b.type === 'Polygon' ? inPolygon(lng, lat, b.coordinates) : b.coordinates.some(p => inPolygon(lng, lat, p));
}

/**
 * Why a boundary cannot be used, or null. A ring needs at least four points
 * (closed), every point a real coordinate, and the area must be in the
 * Philippines (roughly) - a pasted polygon in the wrong order (lat, lng) lands
 * in the sea off Antarctica and is refused rather than silently used.
 */
export function boundaryProblem(raw: unknown): string | null {
  const g = raw && typeof raw === 'object' && 'type' in (raw as object) && (raw as { type: string }).type === 'Feature'
    ? (raw as { geometry: unknown }).geometry : raw;
  if (!g || typeof g !== 'object') return 'Paste a GeoJSON Polygon or MultiPolygon.';
  const t = (g as { type?: string }).type;
  const c = (g as { coordinates?: unknown }).coordinates;
  if (t !== 'Polygon' && t !== 'MultiPolygon') return 'The boundary must be a GeoJSON Polygon or MultiPolygon.';
  const polys = (t === 'Polygon' ? [c] : c) as unknown[];
  if (!Array.isArray(polys) || !polys.length) return 'The boundary has no coordinates.';
  for (const p of polys) {
    if (!Array.isArray(p) || !p.length) return 'A polygon has no rings.';
    for (const ring of p as unknown[]) {
      if (!Array.isArray(ring) || ring.length < 4) return 'Each ring needs at least four points (the first repeated at the end).';
      for (const pt of ring as unknown[]) {
        if (!Array.isArray(pt) || pt.length < 2 || !pt.every(v => typeof v === 'number' && Number.isFinite(v))) return 'Every point must be [longitude, latitude].';
        const [lng, lat] = pt as number[];
        if (lng < 116 || lng > 127 || lat < 4 || lat > 22) return 'A point is outside the Philippines - check that each point is [longitude, latitude], not [latitude, longitude].';
      }
    }
  }
  return null;
}
/** The geometry from a GeoJSON value already checked by boundaryProblem. */
export const boundaryGeometry = (raw: unknown): BoundaryGeometry =>
  ((raw as { type: string }).type === 'Feature' ? (raw as { geometry: BoundaryGeometry }).geometry : raw) as BoundaryGeometry;

/**
 * A rough box around the configured centre, only to notice a pin that is
 * plainly far away (another town) while no boundary is configured. It never
 * decides that a pin is inside.
 */
export function farFromCentre(lat: number, lng: number, centre: { lat: number; lng: number }, km = 5): boolean {
  const dLat = (lat - centre.lat) * 111;
  const dLng = (lng - centre.lng) * 111 * Math.cos((centre.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) > km;
}

// ── Checking a location ──────────────────────────────────────────────────────

export interface LocationInput {
  province?: string | null;
  municipality?: string | null;
  barangay?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  purok?: string | null;
  /** A landmark or other details (an incident's "near the chapel"). */
  details?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Where a location stands. INSIDE and NEEDS_REVIEW may go on (to a verifier, or as a case); OUTSIDE and INCOMPLETE may not. */
export type LocationStatus = 'INSIDE' | 'OUTSIDE' | 'INCOMPLETE' | 'NEEDS_REVIEW';
export type BoundaryResult = 'INSIDE' | 'OUTSIDE' | 'NOT_CONFIGURED' | 'NO_PIN';
export type SelectionResult = 'MATCH' | 'OTHER_BARANGAY' | 'OTHER_MUNICIPALITY' | 'OTHER_PROVINCE' | 'INCOMPLETE';

export const LOCATION_FLAGS = {
  BOUNDARY_NOT_CONFIGURED: 'No official boundary is configured, so the map pin could not be checked - a person must review it.',
  NO_PIN: 'No map location was given - the address is verified by a person (manual verification).',
  PIN_OUTSIDE_BOUNDARY: 'The address names the barangay, but the map pin is outside its official boundary.',
  PIN_INSIDE_OTHER_ADDRESS: 'The map pin is inside the barangay, but the address names another place.',
  PIN_FAR_AWAY: 'The map pin is far from the barangay.',
  STREET_NOT_ON_RECORD: 'The street is not on the barangay\'s street list.',
  LOCATION_UNVERIFIED: 'Neither a map pin inside the official boundary nor a street on the barangay\'s own list places the incident - a person must verify the location.',
} as const;
export type LocationFlag = keyof typeof LOCATION_FLAGS;

export interface LocationCheck {
  kind: 'residence' | 'incident';
  status: LocationStatus;
  selection: SelectionResult;
  boundary: BoundaryResult;
  /** What is missing, in the form's words. */
  missing: string[];
  street: ReturnType<typeof matchStreet> | null;
  flags: LocationFlag[];
  /** Where to go instead, when the location is outside: the place the resident named. */
  destination: { barangay: string | null; municipality: string | null; province: string | null } | null;
  /** Said to the resident, in Filipino then English - from these rules, never from the AI. */
  explanation: string;
  /** The jurisdiction it was checked against. */
  jurisdiction: { barangay: string; municipality: string; province: string; boundaryConfigured: boolean };
}

const present = (v: string | null | undefined) => Boolean(v && v.trim());
const hasPin = (i: LocationInput) => typeof i.latitude === 'number' && typeof i.longitude === 'number'
  && Number.isFinite(i.latitude) && Number.isFinite(i.longitude) && Math.abs(i.latitude) <= 90 && Math.abs(i.longitude) <= 180;

export const MESSAGES = {
  residenceIncomplete: 'Hindi pa kumpleto ang inyong residential address. Pakikumpleto ang barangay at street information upang ma-verify kung kabilang kayo sa sakop ng SafeComm. (Your residential address is incomplete. Please complete the barangay and street so we can check whether you are within SafeComm\'s coverage.)',
  residenceOutside: (j: string) => `Ang SafeComm ay para lamang sa mga residente ng ${j}. Ang address na inilagay ninyo ay nasa labas ng sakop na ito, kaya hindi ito maaaprubahan bilang SafeComm resident account. Mangyaring makipag-ugnayan sa inyong sariling barangay. (SafeComm registration is limited to verified residents of ${j}. The address you entered is outside this area, so it cannot be approved as a SafeComm resident account. Please contact your own barangay.)`,
  residenceReview: 'Maaaring isumite ang inyong address para sa beripikasyon. Susuriin ito ng isang awtorisadong opisyal ng barangay bago ma-activate ang inyong account. (Your address can be submitted for verification. An authorised barangay official reviews it before your account is activated.)',
  incidentIncomplete: 'Hindi pa kumpleto ang lokasyon ng insidente. Pakilagay ang barangay at ang street o palatandaan ng lugar. (The incident location is incomplete. Please give the barangay and the street or a landmark.)',
  incidentOutside: 'Ang lokasyong inilagay ninyo ay nasa labas ng sakop ng SafeComm, kaya ito ay isusumite bilang referral at hindi bilang karaniwang SafeComm case. Susuriin ito ng barangay at ididirekta sa kinauukulang barangay o awtoridad; makipag-ugnayan din sa kanila kung kailangan. (The location is outside SafeComm\'s coverage, so this is submitted as a referral, not an ordinary SafeComm case. The barangay reviews it to direct the concern to the right jurisdiction; you may also contact the barangay or authority where it happened.)',
  incidentInside: 'Na-verify ang inyong resident account at ang lokasyon ng insidente ay nasa sakop ng SafeComm. Maaari na kayong magpatuloy sa kasalukuyang reporting process. (Your resident account is verified and the incident location is within SafeComm\'s coverage. You may continue with your report.)',
  incidentReview: 'Hindi pa ma-verify kung nasa loob o labas ng barangay ang lokasyon, kaya ito ay ipapasa para sa beripikasyon ng lokasyon. Isang opisyal ang magpapasya kung ito ay SafeComm case o referral. (The location cannot be confirmed as inside or outside the barangay, so it goes to location verification. An official decides whether it becomes a SafeComm case or a referral.)',
};

/**
 * Check a residential address or an incident location against the
 * jurisdiction. `centre` is only used to notice a pin far away while no
 * boundary is configured.
 */
export function checkLocation(input: LocationInput, cfg: JurisdictionConfig, kind: 'residence' | 'incident', centre?: { lat: number; lng: number }): LocationCheck {
  const jName = `${cfg.barangay}, ${cfg.municipality}, ${cfg.province}`;
  const jurisdiction = { barangay: cfg.barangay, municipality: cfg.municipality, province: cfg.province, boundaryConfigured: Boolean(cfg.boundary) };
  const missing: string[] = [];
  if (!present(input.province)) missing.push('Province');
  if (!present(input.municipality)) missing.push('Municipality / city');
  if (!present(input.barangay)) missing.push('Barangay');
  if (kind === 'residence' && !present(input.street)) missing.push('Street');
  if (kind === 'incident' && !present(input.street) && !present(input.details)) missing.push('Street or landmark');

  const selection: SelectionResult = missing.some(m => m !== 'Street' && m !== 'Street or landmark') ? 'INCOMPLETE'
    : !sameName(input.province, cfg.province) ? 'OTHER_PROVINCE'
      : !sameName(input.municipality, cfg.municipality) ? 'OTHER_MUNICIPALITY'
        : !isJurisdictionBarangay(input.barangay, cfg) ? 'OTHER_BARANGAY' : 'MATCH';
  const pin = hasPin(input);
  const boundary: BoundaryResult = !pin ? 'NO_PIN' : !cfg.boundary ? 'NOT_CONFIGURED'
    : pointInBoundary(input.latitude as number, input.longitude as number, cfg.boundary) ? 'INSIDE' : 'OUTSIDE';
  const street = present(input.street) && selection === 'MATCH' ? matchStreet(input.street) : null;

  const flags: LocationFlag[] = [];
  if (boundary === 'NOT_CONFIGURED') flags.push('BOUNDARY_NOT_CONFIGURED');
  if (boundary === 'NO_PIN' && kind === 'residence') flags.push('NO_PIN');
  if (selection === 'MATCH' && boundary === 'OUTSIDE') flags.push('PIN_OUTSIDE_BOUNDARY');
  if (selection !== 'MATCH' && selection !== 'INCOMPLETE' && boundary === 'INSIDE') flags.push('PIN_INSIDE_OTHER_ADDRESS');
  if (pin && boundary === 'NOT_CONFIGURED' && centre && farFromCentre(input.latitude as number, input.longitude as number, centre)) flags.push('PIN_FAR_AWAY');
  if (street && !street.known && kind === 'residence') flags.push('STREET_NOT_ON_RECORD');
  // An incident named in the barangay is placed by geography first - the pin against the official
  // boundary - and only without a usable pin by the barangay's own street list (the streets on its
  // hazard map). A typed street that is not on that list, or a landmark alone, places nothing.
  const pinDecides = boundary === 'INSIDE' || boundary === 'OUTSIDE';
  if (kind === 'incident' && selection === 'MATCH' && !pinDecides && !flags.includes('PIN_FAR_AWAY') && !street?.known) {
    if (street && !street.known) flags.push('STREET_NOT_ON_RECORD');
    flags.push('LOCATION_UNVERIFIED');
  }

  const destination = selection === 'OTHER_BARANGAY' || selection === 'OTHER_MUNICIPALITY' || selection === 'OTHER_PROVINCE'
    ? { barangay: input.barangay?.trim() || null, municipality: input.municipality?.trim() || null, province: input.province?.trim() || null } : null;

  let status: LocationStatus;
  if (missing.length) status = 'INCOMPLETE';
  // Another place named, and the pin does not say otherwise: outside. The pin inside with another
  // place named is a contradiction for a person to settle - never an approval.
  else if (selection !== 'MATCH') status = flags.includes('PIN_INSIDE_OTHER_ADDRESS') ? 'NEEDS_REVIEW' : 'OUTSIDE';
  // An incident whose pin is inside the official boundary is inside, whatever the street is called.
  else if (kind === 'incident' && boundary === 'INSIDE') status = 'INSIDE';
  else if (flags.some(f => f !== 'STREET_NOT_ON_RECORD' && f !== 'NO_PIN' && f !== 'BOUNDARY_NOT_CONFIGURED') || flags.includes('STREET_NOT_ON_RECORD')) status = 'NEEDS_REVIEW';
  else if (boundary === 'INSIDE') status = 'INSIDE';
  // Inside by the address: a residence still goes to a verifier; an incident on one of the
  // barangay's own streets is inside (LOCATION_UNVERIFIED above has already caught the rest).
  else status = kind === 'residence' ? 'NEEDS_REVIEW' : 'INSIDE';

  const explanation = kind === 'residence'
    ? status === 'INCOMPLETE' ? MESSAGES.residenceIncomplete
      : status === 'OUTSIDE' ? MESSAGES.residenceOutside(jName)
        : [MESSAGES.residenceReview, ...flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED').map(f => LOCATION_FLAGS[f]),
          ...(street && !street.known && street.suggestions.length ? [`Did you mean: ${street.suggestions.join(', ')}? (Choose it only if it is your street.)`] : [])].join(' ')
    : status === 'INCOMPLETE' ? MESSAGES.incidentIncomplete
      : status === 'OUTSIDE' ? MESSAGES.incidentOutside
        : status === 'NEEDS_REVIEW' ? [MESSAGES.incidentReview, ...flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED').map(f => LOCATION_FLAGS[f])].join(' ')
          : MESSAGES.incidentInside;
  return { kind, status, selection, boundary, missing, street, flags, destination, explanation, jurisdiction };
}

// ── Residency status ─────────────────────────────────────────────────────────

export const RESIDENCY_STATUSES = {
  INCOMPLETE: 'Incomplete Registration',
  PENDING_VERIFICATION: 'Pending Verification',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  NEEDS_INFO: 'Requires Additional Information',
} as const;
export type ResidencyStatus = keyof typeof RESIDENCY_STATUSES;
export const RESIDENCY_STATUS_KEYS = Object.keys(RESIDENCY_STATUSES) as [ResidencyStatus, ...ResidencyStatus[]];
export const isVerifiedResident = (s: string | null | undefined) => s === 'VERIFIED';
/** The resident may (re)submit the application from these. */
export const CAN_SUBMIT_FROM: ResidencyStatus[] = ['INCOMPLETE', 'NEEDS_INFO', 'REJECTED'];
/** A verifier decides from these. */
export const DECIDE_FROM: ResidencyStatus[] = ['PENDING_VERIFICATION'];

/** The residential address in one line, as the resident gave it. */
export function addressLine(a: { houseNumber?: string | null; street?: string | null; purok?: string | null; barangay?: string | null; municipality?: string | null; province?: string | null }) {
  return [[a.houseNumber, a.street].filter(present).join(' '), a.purok, a.barangay ? `Brgy. ${a.barangay}` : null, a.municipality, a.province]
    .filter(present).map(s => String(s).trim()).join(', ');
}

// ── The structured eligibility answer ────────────────────────────────────────

/**
 * The fields the AI-assisted eligibility answer carries. Every one of them
 * comes from the checks above and the resident's verification status - the
 * AI may only phrase the explanation and ask clarifying questions; it never
 * sets a status, a match, a destination or whether a person must review.
 */
export interface EligibilityAnswer {
  residential_address_status: LocationStatus | 'NOT_GIVEN';
  residency_status: ResidencyStatus;
  incident_location_status: LocationStatus | 'NOT_GIVEN';
  jurisdiction_match: boolean;
  missing_information: string[];
  recommended_destination: string | null;
  referral_required: boolean;
  explanation: string;
  requires_human_review: boolean;
  /** May the resident file a standard SafeComm report now (incident given) / submit for verification (residence only). */
  may_proceed: boolean;
  /** Questions to clear up an ambiguous address - from the AI when it is on, else from the rules. */
  clarifying_questions: string[];
  ai_used: boolean;
}

export function eligibilityAnswer(residency: ResidencyStatus, home: LocationCheck | null, incident: LocationCheck | null): EligibilityAnswer {
  const decisive = incident ?? home;
  const dest = decisive?.destination ? [decisive.destination.barangay, decisive.destination.municipality, decisive.destination.province].filter(Boolean).join(', ') : null;
  const verified = isVerifiedResident(residency);
  const residentOk = verified || !incident;
  const explanation = incident
    ? !verified ? 'Ang standard na pag-uulat sa Resident Portal ay para lamang sa mga na-verify na residente ng sakop ng SafeComm. (Standard reporting through the Resident Portal is limited to verified residents within SafeComm\'s jurisdiction.)'
      : incident.explanation
    : home?.explanation ?? '';
  const outside = decisive?.status === 'OUTSIDE';
  const questions: string[] = [];
  for (const m of decisive?.missing ?? []) questions.push(`Ano ang ${m.toLowerCase()}? (What is the ${m.toLowerCase()}?)`);
  if (decisive?.street && !decisive.street.known && decisive.street.suggestions.length) {
    questions.push(`Ang ibig ba ninyong sabihin ay ${decisive.street.suggestions.join(' o ')}? (Did you mean ${decisive.street.suggestions.join(' or ')}?)`);
  }
  if (decisive?.flags.includes('PIN_INSIDE_OTHER_ADDRESS') || decisive?.flags.includes('PIN_OUTSIDE_BOUNDARY')) {
    questions.push('Tama ba ang barangay na pinili ninyo at ang lugar ng pin sa mapa? (Are the barangay you chose and the pin on the map both correct?)');
  }
  return {
    residential_address_status: home?.status ?? 'NOT_GIVEN',
    residency_status: residency,
    incident_location_status: incident?.status ?? 'NOT_GIVEN',
    jurisdiction_match: Boolean(decisive && (decisive.status === 'INSIDE' || decisive.status === 'NEEDS_REVIEW') && decisive.selection === 'MATCH'),
    missing_information: decisive?.missing ?? [],
    recommended_destination: outside ? (dest || 'The barangay or local authority where the place is') : null,
    referral_required: outside || (Boolean(incident) && !verified),
    explanation,
    requires_human_review: decisive?.status === 'NEEDS_REVIEW' || (!incident && Boolean(home) && home!.status !== 'INCOMPLETE' && home!.status !== 'OUTSIDE'),
    may_proceed: incident ? residentOk && (incident.status === 'INSIDE' || incident.status === 'NEEDS_REVIEW')
      : Boolean(home && (home.status === 'INSIDE' || home.status === 'NEEDS_REVIEW')),
    clarifying_questions: questions,
    ai_used: false,
  };
}

// ── Referrals ────────────────────────────────────────────────────────────────

export const REFERRAL_KINDS = {
  OUTSIDE_JURISDICTION: 'Incident outside SafeComm\'s jurisdiction',
  LOCATION_VERIFICATION: 'Incident location needs verification',
  UNVERIFIED_REPORTER: 'Reporter not (yet) a verified resident',
  URGENT: 'Urgent safety concern',
} as const;
export type ReferralKind = keyof typeof REFERRAL_KINDS;
export const REFERRAL_KIND_KEYS = Object.keys(REFERRAL_KINDS) as [ReferralKind, ...ReferralKind[]];

/**
 * Where a referral record stands. "Acknowledged" means the receiving office's
 * acknowledgment was actually recorded by an official - never assumed from
 * the record having been forwarded.
 */
export const REFERRAL_STATUSES = {
  PENDING_REVIEW: 'Pending Review',
  FOR_VERIFICATION: 'For Verification',
  READY_FOR_REFERRAL: 'Ready for Referral',
  REFERRED: 'Referred',
  ACKNOWLEDGED: 'Acknowledged by Receiving Office',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  CLOSED: 'Closed',
} as const;
export type ReferralStatus = keyof typeof REFERRAL_STATUSES;
export const REFERRAL_STATUS_KEYS = Object.keys(REFERRAL_STATUSES) as [ReferralStatus, ...ReferralStatus[]];

/** What the resident is told each status means - general, and never that another office accepted anything it has not acknowledged. */
export const REFERRAL_STATUS_FOR_RESIDENT: Record<ReferralStatus, string> = {
  PENDING_REVIEW: 'The barangay has received your referral and will review it.',
  FOR_VERIFICATION: 'An official is checking where the incident happened before deciding how it is handled.',
  READY_FOR_REFERRAL: 'The barangay has reviewed it and is preparing to refer it to the responsible office.',
  REFERRED: 'The barangay has sent it to the responsible office. That office has not confirmed receipt yet.',
  ACKNOWLEDGED: 'The responsible office has acknowledged receiving the referral.',
  FOLLOW_UP_REQUIRED: 'The barangay needs to follow up on this referral.',
  CLOSED: 'This referral record is closed.',
};

/** What a location check means for a resident's report: a case, a referral, or a person to verify the place first. */
export type IncidentOutcome = 'CASE' | 'REFERRAL' | 'LOCATION_VERIFICATION' | 'INCOMPLETE';
export function incidentOutcome(check: Pick<LocationCheck, 'status'>): IncidentOutcome {
  return check.status === 'INSIDE' ? 'CASE' : check.status === 'OUTSIDE' ? 'REFERRAL' : check.status === 'NEEDS_REVIEW' ? 'LOCATION_VERIFICATION' : 'INCOMPLETE';
}

/** The referral reason, written from the server's check - never from the resident or the AI. */
export function referralReason(check: LocationCheck): string {
  const j = `Barangay ${check.jurisdiction.barangay}, ${check.jurisdiction.municipality}, ${check.jurisdiction.province}`;
  if (check.status === 'OUTSIDE') {
    const why = check.selection === 'OTHER_PROVINCE' ? 'the province given is not ' + check.jurisdiction.province
      : check.selection === 'OTHER_MUNICIPALITY' ? 'the municipality given is not ' + check.jurisdiction.municipality
        : 'the barangay given is not ' + check.jurisdiction.barangay;
    return `Incident location is outside the authorized jurisdiction of ${j} (${why}).`;
  }
  const flags = check.flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED' && f !== 'NO_PIN').map(f => LOCATION_FLAGS[f]);
  return `The incident location could not be verified as inside or outside ${j}${flags.length ? `: ${flags.join(' ')}` : '.'}`;
}

/** The validation result in one line, for the referral record and the review screen. */
export function validationSummary(check: LocationCheck): string {
  const sel = { MATCH: 'address names the barangay', OTHER_BARANGAY: 'address names another barangay', OTHER_MUNICIPALITY: 'address names another municipality',
    OTHER_PROVINCE: 'address names another province', INCOMPLETE: 'address incomplete' }[check.selection];
  const pin = { INSIDE: 'map pin inside the official boundary', OUTSIDE: 'map pin outside the official boundary', NOT_CONFIGURED: 'map pin not checked (no official boundary configured)', NO_PIN: 'no map pin' }[check.boundary];
  const street = check.street ? (check.street.known ? `street on the barangay's list (${check.street.match})` : 'street not on the barangay\'s list') : null;
  return [sel, pin, street].filter(Boolean).join('; ');
}
