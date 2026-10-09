/**
 * Server-side geocoding.
 *
 * It runs here rather than in the browser for three reasons. Nominatim's
 * policy asks for an identifying User-Agent and no more than one request a
 * second, neither of which can be promised from a page open on twenty phones.
 * A cache in front of it means the same corner is looked up once rather than
 * once per resident. And keeping it server-side leaves room to swap in a paid
 * provider later behind a key that never reaches the client.
 *
 * Nothing here needs a key today. If one is added, it belongs in the
 * environment and stays in this file.
 */

import { toResolvedLocation, type ResolvedLocation, type NominatimPlace } from './geo';

const BASE = process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';

/**
 * Nominatim asks that applications identify themselves. A contact address can
 * be set so they can get in touch rather than simply blocking the barangay.
 */
const USER_AGENT = process.env.GEOCODER_USER_AGENT
  ?? 'SafeComm/1.0 (barangay public safety reporting; +https://github.com/N-luis/safcom)';

/** Their policy is one request per second, so requests queue behind this. */
const MIN_INTERVAL_MS = 1100;
let lastCallAt = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Serialised, so two residents pinning at once cannot double the rate. */
function queued<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await run(); } finally { lastCallAt = Date.now(); }
  });
  // The chain must not break on a rejection, or every later call inherits it.
  chain = next.catch(() => {});
  return next as Promise<T>;
}

/** Small and short-lived: a barangay only has so many corners. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value as T;
}

function store(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

const TIMEOUT_MS = 8000;

async function call<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    // A provider that is down, slow or rate-limiting must not stop a report
    // being filed; the caller falls back to manual entry.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The address at a point, or null when the provider cannot name one. */
export async function reverseGeocode(lat: number, lng: number): Promise<ResolvedLocation | null> {
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cached<ResolvedLocation>(key);
  if (hit) return hit;

  const place = await queued(() => call<NominatimPlace>(
    `/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=18`,
  ));
  if (!place) return null;

  const resolved = toResolvedLocation(place, { lat, lng });
  store(key, resolved);
  return resolved;
}

export interface PlaceResult extends ResolvedLocation {
  /** What to show in the results list. */
  title: string;
}

/**
 * Places matching a search, biased to the barangay's area.
 *
 * Bounded rather than filtered: a resident searching for a landmark on the
 * far side of Bocaue should still find it, it just should not outrank the
 * street they are standing on.
 */
export async function searchPlaces(query: string, limit = 6): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const key = `s:${q.toLowerCase()}`;
  const hit = cached<PlaceResult[]>(key);
  if (hit) return hit;

  const { BARANGAY_BOUNDS } = await import('./geo');
  const box = [BARANGAY_BOUNDS.west, BARANGAY_BOUNDS.north, BARANGAY_BOUNDS.east, BARANGAY_BOUNDS.south].join(',');
  const places = await queued(() => call<NominatimPlace[]>(
    `/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=${limit}`
    + `&countrycodes=ph&viewbox=${box}&bounded=0`,
  ));
  if (!Array.isArray(places)) return [];

  const results = places.map(p => {
    const r = toResolvedLocation(p, { lat: 0, lng: 0 });
    return { ...r, title: r.label ?? r.street ?? q };
  }).filter(r => r.latitude !== 0 || r.longitude !== 0);

  store(key, results);
  return results;
}
