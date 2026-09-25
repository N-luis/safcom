/**
 * Sign-in accepts either an email address or a username, so login forms take a
 * single "identifier" field instead of forcing the user to pick a mode.
 */

export const USERNAME_RULE = /^[a-zA-Z0-9._-]{3,20}$/;

export function isEmail(value: string): boolean {
  return value.includes('@');
}

/** Usernames are matched case-insensitively; emails already are in practice. */
export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Prisma `where` that matches an account by email OR username.
 * Case-insensitive on both so "Nico" and "nico" reach the same account.
 */
export function identifierWhere(raw: string) {
  const value = raw.trim();
  return {
    OR: [
      { email: { equals: value, mode: 'insensitive' as const } },
      { username: { equals: value, mode: 'insensitive' as const } },
    ],
  };
}

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Username is required';
  if (v.includes('@')) return 'Username cannot contain @';
  if (!USERNAME_RULE.test(v)) {
    return 'Use 3–20 characters: letters, numbers, dot, dash or underscore';
  }
  return null;
}
