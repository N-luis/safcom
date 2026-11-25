import { prisma } from './prisma';
import { normalizeName, streetKey } from './jurisdiction';

/**
 * Verified streets per barangay (030) - what File a Report offers in the
 * Street field for the place the resident chose, and the server's check that
 * a chosen street really belongs to that place.
 *
 * Only streets recorded in VerifiedStreet with a source count. Today that is
 * Barangay Biñang 2nd's list (its hazard map); every other barangay gets
 * manual street entry. A map provider's search result is never added here as
 * proof that a road is in a barangay.
 */

export interface StreetOption { id: string; name: string; aliases: string[] }
interface Row extends StreetOption { province: string; municipality: string; barangay: string; source: string }
export interface Place { province?: string | null; municipality?: string | null; barangay?: string | null }

let cache: { at: number; rows: Row[] } | null = null;
const TTL = 5 * 60_000;
async function rows(): Promise<Row[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const r = await prisma.verifiedStreet.findMany({ where: { active: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, aliases: true, province: true, municipality: true, barangay: true, source: true } });
  cache = { at: Date.now(), rows: r };
  return r;
}
export const forgetVerifiedStreets = () => { cache = null; };

const same = (a: string | null | undefined, b: string) => normalizeName(a) !== '' && normalizeName(a) === normalizeName(b);
const inPlace = (r: Row, p: Place) => same(p.province, r.province) && same(p.municipality, r.municipality) && same(p.barangay, r.barangay);
export const placeIdentified = (p: Place) => Boolean(p.province?.trim() && p.municipality?.trim() && p.barangay?.trim());

/** The verified streets of one barangay - empty when it has no verified list (manual entry). */
export async function streetsFor(p: Place): Promise<{ identified: boolean; streets: StreetOption[]; source: string | null }> {
  if (!placeIdentified(p)) return { identified: false, streets: [], source: null };
  const list = (await rows()).filter(r => inPlace(r, p));
  return { identified: true, streets: list.map(r => ({ id: r.id, name: r.name, aliases: r.aliases })), source: list[0]?.source ?? null };
}

const matchesName = (r: Pick<Row, 'name' | 'aliases'>, street: string) => {
  const k = streetKey(street);
  return k !== '' && [r.name, ...r.aliases].some(n => streetKey(n) === k);
};

export type ResolvedStreet =
  | { ok: true; streetId: string | null; streetName: string | null; manual: boolean | null }
  | { ok: false; code: 'STREET_NOT_VERIFIED' | 'STREET_PLACE_MISMATCH' | 'STREET_NAME_MISMATCH'; error: string };

/**
 * The incident's street, checked on the server. A street id sent by the form
 * must be a verified street of the barangay, municipality and province given,
 * and must be the street named - otherwise the report is refused, so a
 * street can never be filed under another barangay. Without an id, a name
 * that matches the place's verified list is linked to it; anything else is
 * kept as typed, marked manual.
 */
export async function resolveIncidentStreet(p: Place & { street?: string | null; streetId?: string | null }): Promise<ResolvedStreet> {
  const street = (p.street ?? '').trim();
  const all = await rows();
  if (p.streetId) {
    const r = all.find(x => x.id === p.streetId);
    if (!r) return { ok: false, code: 'STREET_NOT_VERIFIED', error: 'That street is not on a verified street list. Choose it again, or type the street name.' };
    if (!inPlace(r, p)) {
      return { ok: false, code: 'STREET_PLACE_MISMATCH', error: `The street chosen belongs to Barangay ${r.barangay}, ${r.municipality}, ${r.province} - not to the place given. Choose the street again after choosing the barangay.` };
    }
    if (street && !matchesName(r, street)) return { ok: false, code: 'STREET_NAME_MISMATCH', error: 'The street name does not match the street chosen. Choose the street again.' };
    return { ok: true, streetId: r.id, streetName: r.name, manual: false };
  }
  if (!street) return { ok: true, streetId: null, streetName: null, manual: null };
  const match = placeIdentified(p) ? all.find(r => inPlace(r, p) && matchesName(r, street)) : undefined;
  return match ? { ok: true, streetId: match.id, streetName: match.name, manual: false } : { ok: true, streetId: null, streetName: street, manual: true };
}
