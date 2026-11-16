import { prisma } from './prisma';

/**
 * Next unissued case number for a prefix, e.g. "SC-2026-0007".
 *
 * Counting the table and adding one looks equivalent but is not: delete any
 * case and the count falls back onto a number that is already taken, and the
 * unique constraint then rejects every new report from that point on. This
 * reads the highest number actually issued for the prefix instead.
 */
export async function nextCaseNumber(kind: string, year = new Date().getFullYear()): Promise<string> {
  const prefix = `${kind}-${year}-`;
  const latest = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: 'desc' },
    select: { caseNumber: true },
  });
  const highest = latest ? Number(latest.caseNumber.slice(prefix.length)) : 0;
  const next = (Number.isFinite(highest) ? highest : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * True for a unique-constraint violation that involves `field`. Prisma names
 * the fields in `meta.target` with its own engine, but under the pg driver
 * adapter this app uses they are in `meta.driverAdapterError.cause.constraint.fields`
 * (quoted) - both are read, or a collision would be taken for a server fault.
 */
export function isUniqueViolationOn(err: unknown, field: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  const fields = [
    ...(Array.isArray(target) ? target : [target]),
    ...((e.meta?.driverAdapterError?.cause?.constraint?.fields as unknown[] | undefined) ?? []),
  ];
  return fields.some(f => typeof f === 'string' && f.replace(/"/g, '').toLowerCase().includes(field.toLowerCase()));
}

/** True for the unique-constraint violation on caseNumber. */
export function isDuplicateCaseNumber(err: unknown): boolean {
  return isUniqueViolationOn(err, 'casenumber');
}

/**
 * Runs `create` with a freshly issued number, retrying if two reports are filed
 * at the same moment and land on the same one.
 */
export async function createWithCaseNumber<T>(
  kind: string,
  create: (caseNumber: string) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const caseNumber = await nextCaseNumber(kind);
    try {
      return await create(caseNumber);
    } catch (err) {
      if (!isDuplicateCaseNumber(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
