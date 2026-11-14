import 'server-only';
import { createHash } from 'crypto';
import { prisma } from './prisma';
import { parseImageDataUrl } from './attachments';
import { visibleToResident } from './followUps';
import type { EvidenceItem } from './evidence';

/** A photo ready to store: decoded, checked, fingerprinted. */
export interface IncomingPhoto { filename: string; mimeType: string; size: number; data: Uint8Array<ArrayBuffer>; sha256: string }

export const fingerprint = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Decode the photos a resident sent (data URLs from the form). The same photo
 * picked twice is kept once. Returns the first problem, naming the file, so the
 * resident is told which one to replace.
 */
export function parsePhotos(incoming: { name: string; dataUrl: string }[]): { photos: IncomingPhoto[] } | { error: string } {
  const photos: IncomingPhoto[] = [];
  for (const a of incoming) {
    const r = parseImageDataUrl(a.dataUrl);
    if ('error' in r) return { error: `${a.name}: ${r.error}` };
    const sha256 = fingerprint(r.bytes);
    if (photos.some(p => p.sha256 === sha256)) continue;
    photos.push({ filename: a.name.slice(0, 200), mimeType: r.mimeType, size: r.bytes.length, data: r.bytes, sha256 });
  }
  return { photos };
}

/**
 * Store a resident's report photos on their case - only those not already on
 * it (by fingerprint), so a retried submission never stores a photo twice and a
 * retry after a partial failure fills in what is missing. Returns how many were added.
 *
 * The check and the insert happen under a lock held for this case, so two
 * submissions arriving at the same moment take turns: the second sees what the
 * first stored, and the same photo is never stored twice.
 */
export async function storeResidentPhotos(caseId: string, residentId: string, photos: IncomingPhoto[]): Promise<number> {
  if (!photos.length) return 0;
  return prisma.$transaction(async tx => {
    // Released when the transaction ends.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`evidence:${caseId}`}))`;
    const have = new Set((await tx.caseAttachment.findMany({
      where: { caseId, hearingId: null, sha256: { in: photos.map(p => p.sha256) } }, select: { sha256: true },
    })).map(a => a.sha256));
    const add = photos.filter(p => !have.has(p.sha256));
    if (add.length) await tx.caseAttachment.createMany({ data: add.map(p => ({ ...p, caseId, uploadedByResidentId: residentId })) });
    return add.length;
  }, { timeout: 20_000 });
}

const select = {
  id: true, filename: true, mimeType: true, size: true, createdAt: true, followUpId: true,
  uploadedByResidentId: true, uploadedByUserId: true,
} as const;

/** A case's evidence for officials: the report's photos and every follow-up's. Hearing records list their own. */
export async function evidenceForStaff(caseId: string): Promise<EvidenceItem[]> {
  const rows = await prisma.caseAttachment.findMany({ where: { caseId, hearingId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select });
  const userIds = [...new Set(rows.map(r => r.uploadedByUserId).filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map(u => [u.id, u.name]));
  return rows.map(r => ({
    id: r.id, filename: r.filename, mimeType: r.mimeType, size: r.size, createdAt: r.createdAt.toISOString(),
    source: r.followUpId ? 'follow_up' : 'report',
    // Never the reporter's name here: an anonymous reporter stays anonymous on every screen.
    uploadedBy: r.uploadedByUserId ? `${name.get(r.uploadedByUserId) ?? 'An official'} (official)` : 'The reporter',
  }));
}

/**
 * A case's evidence for the resident who filed it: the report's photos, and the
 * photos of follow-ups they are shown (their own, or an update shared with them).
 * Never a hearing record's, never an official's internal note.
 */
export async function evidenceForResident(caseId: string, residentId: string): Promise<EvidenceItem[] | null> {
  const own = await prisma.case.findFirst({ where: { id: caseId, residentId }, select: { id: true } });
  if (!own) return null;
  const shown = visibleToResident(await prisma.caseFollowUp.findMany({ where: { caseId }, select: { id: true, visibleToReporter: true, hiddenAt: true } })).map(f => f.id);
  const rows = await prisma.caseAttachment.findMany({
    where: { caseId, hearingId: null, OR: [{ followUpId: null }, { followUpId: { in: shown } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select,
  });
  return rows.map(r => ({
    id: r.id, filename: r.filename, mimeType: r.mimeType, size: r.size, createdAt: r.createdAt.toISOString(),
    source: r.followUpId ? 'follow_up' : 'report',
    uploadedBy: r.uploadedByResidentId === residentId ? 'You' : 'The barangay',
  }));
}

/** May this resident open this photo? The same rule as their evidence list. */
export async function residentMayView(a: { caseId: string; followUpId: string | null; hearingId: string | null }, residentId: string): Promise<boolean> {
  if (a.hearingId) return false;
  const own = await prisma.case.count({ where: { id: a.caseId, residentId } });
  if (!own) return false;
  if (!a.followUpId) return true;
  const f = await prisma.caseFollowUp.findUnique({ where: { id: a.followUpId }, select: { visibleToReporter: true, hiddenAt: true } });
  return Boolean(f && visibleToResident([f]).length);
}
