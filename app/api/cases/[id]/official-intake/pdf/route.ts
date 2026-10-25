import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { decideIntakeAccess, loadIntakeCase, logIntakeAccess } from '@/lib/officialIntake';
import { buildIntakePdf } from '@/lib/intakePdf';
import type { Responses } from '@/lib/officialIntakeForm';

/**
 * The saved intake as a PDF, laid out like the barangay's intake form.
 *
 * The same access as viewing the intake (lib/officialIntake.ts), decided on
 * the server; every export is written to the audit log, permitted or
 * refused. Built from what is saved - unsaved edits on someone's screen are
 * not in it - and never cached.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  try {
    const actor = await loadActor(auth.user.userId);
    if (!actor) return errorResponse('Unauthorized', 401);
    const c = await loadIntakeCase(id);
    const log = (outcome: 'permitted' | 'denied', code: string) =>
      logIntakeAccess({ actorId: actor.id, actorRole: actor.role, caseId: id, caseNumber: c?.caseNumber, outcome, code: `pdf_export:${code}` });
    if (!c) { await log('denied', 'not_found'); return errorResponse('Case not found', 404); }
    const access = decideIntakeAccess(actor, c);
    if (access.hidden) { await log('denied', access.code); return errorResponse('Case not found', 404); }
    if (!access.view) { await log('denied', access.code); return errorResponse(access.message ?? 'Not permitted', 403); }
    const intake = c.officialIntake;
    if (!intake) { await log('denied', 'no_intake'); return errorResponse('This case has no intake to export yet', 404); }

    const ids = [actor.id, intake.completedById].filter((x): x is string => Boolean(x));
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const name = (uid: string | null) => (uid && users.find(u => u.id === uid)?.name) || null;
    const bytes = await buildIntakePdf({
      caseNumber: c.caseNumber, status: intake.status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT', version: intake.version,
      responses: intake.responses as Responses, exportedBy: name(actor.id) ?? 'an official', exportedAt: new Date(),
      completedBy: name(intake.completedById), completedAt: intake.completedAt,
    });
    // Recorded before it is sent.
    await log('permitted', access.code);
    const file = `Intake-${c.caseNumber.replace(/[^\w-]/g, '')}${intake.status === 'COMPLETED' ? '' : '-DRAFT'}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[Intake PDF]', err instanceof Error ? err.message : 'failed');
    return errorResponse('The PDF could not be made right now.', 503);
  }
}
