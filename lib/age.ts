/**
 * Age from a date of birth, for the walk-in report's date picker.
 *
 * Kept out of the page so the rule can be tested on its own — importing it
 * from a 'use client' page drags the whole component tree along with it.
 */

/** Oldest age the date picker will accept — a guard against a mistyped year. */
export const MAX_AGE = 120;

/**
 * Whole years between a date of birth and today, counting a birthday that has
 * not come round yet as the previous year, the way an ID does it.
 * Returns null when the date is missing, unparseable or still in the future.
 */
export function ageOn(birthDate: string, today: Date = new Date()): number | null {
  if (!birthDate) return null;
  // Parsed at local midnight on purpose: `new Date('2000-01-01')` is UTC, which
  // lands on the previous day behind a negative offset and shifts the birthday.
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime()) || b > today) return null;

  let age = today.getFullYear() - b.getFullYear();
  const beforeBirthday =
    today.getMonth() < b.getMonth()
    || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

/** The range a birth date may fall in: not in the future, not absurdly old. */
export function birthDateBounds(now: Date = new Date()): { min: string; max: string } {
  const oldest = new Date(now.getFullYear() - MAX_AGE, now.getMonth(), now.getDate());
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { min: iso(oldest), max: iso(now) };
}
