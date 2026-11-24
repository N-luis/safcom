import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore } from '@/lib/caseRecordsServer';
import { rateLimit } from '@/lib/rateLimit';
import { logRouteError } from '@/lib/hearingCasesServer';
import { guideReply, organizeNarrative } from '@/lib/reportGuideServer';

export const dynamic = 'force-dynamic';

/**
 * The Reporting Assistant on File a Report (the signed-in resident only).
 *
 *   { action: 'chat', messages, lang }   - one answer: a reply, the desk
 *        SafeComm's own rules recommend for what was described (not final),
 *        what to provide, questions, and whether to call a hotline first.
 *   { action: 'organize', text }         - the resident's description,
 *        organized from their own words only, for them to use, edit or not.
 *
 * Nothing is stored and no record is read: not the conversation, not the
 * draft, not anyone's case. The report itself is filed by the existing form.
 */
const message = z.object({ role: z.enum(['resident', 'assistant']), text: z.string().trim().min(1).max(2000) }).strict();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('chat'), messages: z.array(message).min(1).max(20), lang: z.enum(['en', 'tl']).default('en') }).strict(),
  z.object({ action: z.literal('organize'), text: z.string().trim().min(1).max(6000) }).strict(),
]);

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check the message', 400);
  const d = parsed.data;
  const me = auth.resident.residentId;
  const limit = d.action === 'chat' ? { max: 40, windowMs: 15 * 60_000 } : { max: 10, windowMs: 3_600_000 };
  if (!rateLimit(`report-guide:${d.action}:${me}`, limit).allowed) {
    return rError(d.action === 'chat' ? 'Too many messages - wait a few minutes. If anyone is in danger, call an emergency hotline now.' : 'Too many requests - wait a while and try again.', 429);
  }
  try {
    // The resident's own name is taken out of everything sent to the AI.
    const r = await prisma.resident.findUnique({ where: { id: me }, select: { firstName: true, lastName: true } });
    const names = r ? [r.firstName, r.lastName].filter(Boolean) : [];
    if (d.action === 'chat') {
      if (d.messages[d.messages.length - 1].role !== 'resident') return rError('The last message must be yours', 400);
      return noStore({ success: true, data: await guideReply({ residentId: me, residentNames: names, messages: d.messages, uiLang: d.lang }) });
    }
    const o = await organizeNarrative({ residentId: me, residentNames: names, text: d.text });
    return noStore({ success: true, data: o });
  } catch (e) {
    logRouteError('POST /api/resident/report-guide', e);
    return rError('The assistant is not available right now. You can still fill in the form and submit your report. If anyone is in danger, call an emergency hotline.', 503);
  }
}
