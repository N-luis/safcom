/**
 * Where an incident happened, as coordinates rather than a dropdown choice.
 *
 * The street list in lib/streets.ts stays the thing cases are grouped by - the
 * heatmap and the reports count by it, and free text produced one bucket per
 * spelling. What this adds is the actual point on the ground, so a report can
 * say "the corner by the sari-sari store" precisely without anyone having to
 * find the right label for it first.
 *
 * Nothing here reads risk. A coordinate records a place; it does not make a
 * case more or less serious, and no part of the assessment looks at it.
 */

/** Biñang 2nd, Bocaue, Bulacan - from Nominatim, not estimated. */
export const BARANGAY_CENTER = {
  lat: Number(process.env.NEXT_PUBLIC_BARANGAY_LAT ?? 14.7947352),
  lng: Number(process.env.NEXT_PUBLIC_BARANGAY_LNG ?? 120.9345743),
};

export const DEFAULT_ZOOM = 16;

/**
 * Roughly the barangay and its immediate surroundings. Used to warn when a
 * pin lands far away - not to block it, because an incident reported here can
 * have happened on the way to somewhere else.
 */
export const BARANGAY_BOUNDS = {
  south: BARANGAY_CENTER.lat - 0.035,
  north: BARANGAY_CENTER.lat + 0.035,
  west: BARANGAY_CENTER.lng - 0.035,
  east: BARANGAY_CENTER.lng + 0.035,
};

/** Filled in when the provider does not name them, which it usually does. */
export const DEFAULT_MUNICIPALITY = process.env.NEXT_PUBLIC_MUNICIPALITY ?? 'Bocaue';
export const DEFAULT_PROVINCE = process.env.NEXT_PUBLIC_PROVINCE ?? 'Bulacan';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  /** The road the point sits on, when the provider could name one. */
  street: string | null;
  barangay: string | null;
  municipality: string | null;
  province: string | null;
  /** The provider's full one-line address, kept for the officer's record. */
  label: string | null;
}

/** A finite number inside the range the format allows. */
export function isValidLatitude(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/** True when the point is near the barangay, so the form can say so. */
export function isWithinBarangay(lat: number, lng: number): boolean {
  return lat >= BARANGAY_BOUNDS.south && lat <= BARANGAY_BOUNDS.north
    && lng >= BARANGAY_BOUNDS.west && lng <= BARANGAY_BOUNDS.east;
}

/** Six decimals is about 0.1m - more precision than a street corner needs. */
export const roundCoord = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The shape Nominatim returns, narrowed to the parts that are used. */
interface NominatimAddress {
  road?: string; pedestrian?: string; footway?: string; residential?: string;
  neighbourhood?: string; quarter?: string; suburb?: string; village?: string;
  town?: string; city?: string; municipality?: string;
  state?: string; province?: string;
}

export interface NominatimPlace {
  lat?: string; lon?: string;
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
}

const firstOf = (...values: (string | undefined)[]): string | null =>
  values.find(v => typeof v === 'string' && v.trim().length > 0)?.trim() ?? null;

/**
 * The parts of an address this system records.
 *
 * A point can legitimately have no road - the middle of a field, an unnamed
 * alley - and that is reported as null rather than guessed at from whatever
 * label happens to be nearest, so the form can ask the resident instead.
 */
export function toResolvedLocation(
  place: NominatimPlace,
  fallback: { lat: number; lng: number },
): ResolvedLocation {
  const a = place.address ?? {};
  const lat = Number(place.lat);
  const lng = Number(place.lon);

  return {
    latitude: roundCoord(isValidLatitude(lat) ? lat : fallback.lat),
    longitude: roundCoord(isValidLongitude(lng) ? lng : fallback.lng),
    street: firstOf(a.road, a.pedestrian, a.residential, a.footway),
    barangay: firstOf(a.quarter, a.neighbourhood, a.village, a.suburb),
    municipality: firstOf(a.town, a.city, a.municipality) ?? DEFAULT_MUNICIPALITY,
    province: firstOf(a.state, a.province) ?? DEFAULT_PROVINCE,
    label: firstOf(place.display_name, place.name),
  };
}
