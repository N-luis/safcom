import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { computeRisk } from '@/lib/riskEngine';
import { parseImageDataUrl, MAX_ATTACHMENTS } from '@/lib/attachments';
import { createWithCaseNumber } from '@/lib/caseNumber';
import { assessCase, priorityToRiskLevel } from '@/lib/caseAssessment';
import { enforceHardRules } from '@/lib/caseClassification';
import { buildEvidence } from '@/lib/reportEvidence';
import { MAX_UNCLEAR_WORDS, type Transcription } from '@/lib/transcription';

const createSchema = z.object({
  caseType: z.string().min(1, 'Case type is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  barangay: z.string().optional(),
  additionalNotes: z.string().optional(),
  // Photos arrive as data URLs; the bytes are decoded and stored separately.
  attachments: z.array(z.object({
    name: z.string().min(1).max(200),
    dataUrl: z.string().min(1),
  })).max(MAX_ATTACHMENTS, `You can attach up to ${MAX_ATTACHMENTS} photos`).optional(),
  // What a photographed document was read as, after the resident confirmed or
  // corrected it. Classified alongside the typed description, but only the
  // parts the reader was sure of - see lib/reportEvidence.
  documentText: z.string().max(4000).optional(),
  documentConfidence: z.enum(['high', 'medium', 'low']).optional(),
  // Trimmed, never refused. This list only ever makes the assessment more
  // careful, so an over-long one must not cost the resident their report -
  // the overflow is handled by flagging the case for a person instead.
  documentUnclearWords: z.array(z.string()).optional()
    .transform(list => (list ?? []).slice(0, MAX_UNCLEAR_WORDS).map(w => w.slice(0, 80))),
  documentReadFailed: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 10)));
  // Accepts a comma-separated group so a caller can ask for exactly what the
  // dashboard counts as one number - "Resolved Cases" there is Resolved plus
  // Closed, which a single exact status could not express.
  const status = (searchParams.get('status') || '')
    .split(',').map(v => v.trim()).filter(Boolean);
  const search = searchParams.get('search') || '';

  const where: Record<string, unknown> = { residentId: auth.resident.residentId };
  if (status.length) where.status = { in: status };
  if (search) {
    where.OR = [
      { caseNumber: { contains: search } },
      { caseType: { contains: search } },
      { description: { contains: search } },
    ];
  }

  try {
    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { filedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, caseNumber: true, caseType: true, status: true,
          riskLevel: true, barangay: true, description: true,
          filedAt: true, updatedAt: true, notes: true,
        },
      }),
      prisma.case.count({ where }),
    ]);
    return rSuccess({ cases, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch {
    return rError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId },
      select: { firstName: true, lastName: true, barangay: true, gender: true },
    });
    if (!resident) return rError('Resident not found', 404);

    const barangay = parsed.data.barangay || resident.barangay;
    const filedAt = new Date();

    const { additionalNotes } = parsed.data;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [barangayCaseCount, residentCaseCount, residentSameTypeCount, highRiskAreaCaseCount] = await Promise.all([
      prisma.case.count({ where: { barangay, filedAt: { gte: thirtyDaysAgo } } }),
      prisma.case.count({ where: { residentId: auth.resident.residentId } }),
      prisma.case.count({
        where: { residentId: auth.resident.residentId, caseType: parsed.data.caseType },
      }),
      prisma.case.count({
        where: {
          barangay,
          caseType: parsed.data.caseType,
          riskLevel: { in: ['High', 'Critical'] },
          filedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const aiRisk = computeRisk({
      caseType: parsed.data.caseType,
      barangay,
      description: parsed.data.description,
      filedAt,
      residentId: auth.resident.residentId,
      status: 'Open',
      barangayCaseCount,
      residentPriorCases: Math.max(0, residentCaseCount),
      residentPriorSameType: Math.max(0, residentSameTypeCount),
      // Physical harm, minors and recurrence are deliberately not passed: the
      // form no longer asks the resident to classify their own incident, so the
      // engine reads them out of the description and the case history instead.
      // Passing false here would have suppressed that detection entirely.
      highRiskAreaCaseCount,
    });

    const notesValue = additionalNotes ? `Notes: ${additionalNotes}` : undefined;

    const incoming = parsed.data.attachments ?? [];
    const photos: { filename: string; mimeType: string; size: number; data: Uint8Array<ArrayBuffer> }[] = [];
    for (const a of incoming) {
      const result = parseImageDataUrl(a.dataUrl);
      if ('error' in result) return rError(`${a.name}: ${result.error}`, 400);
      photos.push({
        filename: a.name, mimeType: result.mimeType,
        size: result.bytes.length, data: result.bytes,
      });
    }

    // A photographed document is evidence, but an unclear reading is not: the
    // guard drops any factor that rests on a word the reader was unsure of and
    // marks the case for a person to read the photo.
    // More unclear words than the report carries means the rest were dropped,
    // and a factor could be resting on one of them. The case is still filed;
    // it is marked so a person reads the photo.
    const unclearOverflowed =
      Array.isArray(body?.documentUnclearWords) && body.documentUnclearWords.length > MAX_UNCLEAR_WORDS;

    const transcription: Transcription | null = parsed.data.documentText || parsed.data.documentReadFailed
      ? {
          text: parsed.data.documentText ?? '',
          confidence: unclearOverflowed ? 'low' : (parsed.data.documentConfidence ?? 'medium'),
          fields: [],
          unclearWords: parsed.data.documentUnclearWords,
          failed: parsed.data.documentReadFailed ?? false,
          ...(unclearOverflowed && {
            message: 'Too much of the attached photo was unclear to rely on, so it needs an officer to read it.',
          }),
        }
      : null;
    const evidence = buildEvidence(parsed.data.description, transcription);

    // Multi-factor triage. The priority comes from what the report describes
    // plus this reporter's own history of the same kind of incident - never
    // from the case type, and never from anything about the person.
    const assessment = assessCase(evidence.classifiedText, {
      priorSameType: residentSameTypeCount,
      areaRecentSameType: highRiskAreaCaseCount,
      gender: resident.gender ?? null,
    });
    // The hard rules are the floor under the weighted factors. A report that
    // names a child being hurt, a weapon alongside a threat, or someone still
    // there now cannot come out Low because the averages landed there. The
    // grounded parameters behind the decision are kept with the case.
    const { level: riskLevel, classification } = enforceHardRules(
      priorityToRiskLevel(assessment.priority),
      {
        report: evidence.classifiedText,
        unclearWords: parsed.data.documentUnclearWords ?? [],
        priorCases: residentSameTypeCount,
        attachments: { photos: photos.length, documents: parsed.data.documentText ? 1 : 0 },
      },
    );

    // Retried: two residents filing at the same moment can be handed the same
    // number, and the unique constraint rejects the loser.
    const newCase = await createWithCaseNumber('SC', caseNumber =>
      prisma.case.create({
        data: {
          caseNumber,
          residentName: `${resident.firstName} ${resident.lastName}`,
          caseType: parsed.data.caseType,
          description: parsed.data.description,
          barangay,
          status: 'Open',
          riskLevel,
          filedAt,
          residentId: auth.resident.residentId,
          ...(notesValue && { notes: notesValue }),
        },
      }),
    );
    const caseNumber = newCase.caseNumber;

    await prisma.caseAssessment.create({
      data: {
        caseId: newCase.id,
        priority: assessment.priority,
        immediateThreat: assessment.factors.immediateThreat,
        incidentSeverity: assessment.factors.incidentSeverity,
        recurrence: assessment.factors.recurrence,
        vulnerability: assessment.factors.vulnerability,
        escalationPotential: assessment.factors.escalationPotential,
        urgency: assessment.factors.urgency,
        summary: assessment.summary,
        reason: assessment.reason,
        detail: JSON.parse(JSON.stringify({
          detectedFactors: assessment.analysis.detectedFactors,
          recommendations: assessment.recommendations,
          safetyReminders: assessment.safetyReminders,
          missingInformation: assessment.missingInformation,
          frequency: assessment.analysis.frequency,
          escalation: assessment.analysis.escalation,
          needsHumanReview: evidence.needsHumanReview || classification.needs_human_review,
          reviewReasons: [
            ...evidence.reviewReasons,
            ...(classification.needs_human_review_reason ? [classification.needs_human_review_reason] : []),
          ],
          // Kept so an officer can see what the decision rested on, and which
          // rules raised it, rather than being handed a level to trust.
          classification: {
            category: classification.case_category,
            categoryConfidence: classification.category_confidence,
            parameters: classification.parameters,
            evidenceFromReport: classification.evidence_from_report,
            routingHints: classification.routing_hints,
            hardRulesApplied: classification.hard_rules_applied,
            classificationScore: classification.score,
            classificationLevel: classification.risk_level,
            classificationExplanation: classification.explanation,
          },
          withheldFactors: evidence.withheldFactors,
          documentText: parsed.data.documentText ?? null,
          documentConfidence: parsed.data.documentConfidence ?? null,
        })),
      },
    });

    if (photos.length) {
      await prisma.caseAttachment.createMany({
        data: photos.map(p => ({ ...p, caseId: newCase.id })),
      });
    }

    // The level the case was actually stored at, not the one the weighted
    // factors reached on their own: an officer reading the feed has to see the
    // same answer the case carries, and which rules put it there.
    const raised = classification.hard_rules_applied.filter(r => r !== 'H6');
    const activityMsg = `Resident filed case ${caseNumber}: ${parsed.data.caseType} — ${riskLevel} risk, priority: ${assessment.priority}`
      + `${raised.length ? ` (rule ${raised.join(', ')})` : ''}`
      + `${aiRisk.highRiskZone ? ' ⚠ HIGH-RISK ZONE' : ''}`;

    await prisma.activity.create({
      data: {
        type: 'case_filed',
        message: activityMsg,
        entityId: newCase.id,
        entityType: 'Case',
        caseId: newCase.id,
        color: riskLevel === 'Critical' ? '#8b5cf6'
          : riskLevel === 'High' ? '#ef4444'
            : riskLevel === 'Medium' ? '#f97316' : '#14b8a6',
      },
    });

    return rSuccess({
      ...newCase,
      aiRiskAssessment: aiRisk,
      assessment,
      needsHumanReview: evidence.needsHumanReview || classification.needs_human_review,
      reviewReasons: [
        ...evidence.reviewReasons,
        ...(classification.needs_human_review_reason ? [classification.needs_human_review_reason] : []),
      ],
      classification,
    }, 201);
  } catch (err) {
    // Logged: a silent 500 here hid an attachment failure that looked identical
    // to any other server fault.
    console.error('[Resident case create]', err);
    return rError('Server error', 500);
  }
}
