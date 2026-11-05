/**
 * Philippine mobile numbers, as SafeComm takes them: "+63" and the 10 digits
 * after it, always starting with 9 (+63 917 123 4567). Pure, so the forms and
 * the server check a number the same way.
 */

export const PH_COUNTRY_CODE = '+63';
export const PH_MOBILE_DIGITS = 10;

/** What a form says when the digits after +63 are not a mobile number. */
export const PH_MOBILE_HINT = 'Enter the 10 digits after +63, starting with 9 (e.g. 917 123 4567)';

/**
 * The digits after +63, from whatever was typed or pasted: anything that is
 * not a digit is dropped, a pasted "+63 ..." or "63..." loses its country
 * code, a habitual leading 0 (0917...) is dropped, and the rest is capped at 10.
 */
export function phMobileLocal(input: string | null | undefined): string {
  let d = (input ?? '').replace(/\D/g, '');
  if (d.startsWith('63') && (d.length >= 12 || /^\s*\+/.test(input ?? ''))) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.slice(0, PH_MOBILE_DIGITS);
}

/** True for exactly 10 digits starting with 9. */
export function isPhMobileLocal(local: string): boolean {
  return /^9\d{9}$/.test(local);
}

/** "9171234567" -> "917 123 4567" (partial input is grouped as far as it goes). */
export function groupPhMobile(local: string): string {
  return [local.slice(0, 3), local.slice(3, 6), local.slice(6, 10)].filter(Boolean).join(' ');
}

/** Any accepted spelling -> "+639171234567", or null when it is not a PH mobile number. */
export function normalizePhMobile(input: string | null | undefined): string | null {
  const local = phMobileLocal(input);
  return isPhMobileLocal(local) ? `${PH_COUNTRY_CODE}${local}` : null;
}

/** For display: "+63 917 123 4567" when it is a PH mobile number, otherwise as stored. */
export function displayPhMobile(stored: string | null | undefined): string {
  const n = normalizePhMobile(stored);
  return n ? `${PH_COUNTRY_CODE} ${groupPhMobile(n.slice(3))}` : (stored ?? '');
}
