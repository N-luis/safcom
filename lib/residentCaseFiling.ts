import 'server-only';
import { after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rSuccess, rError } from '@/lib/residentAuth';
import { computeRisk } from '@/lib/riskEngine';
import { MAX_ATTACHMENTS } from '@/lib/attachments';
import { storeResidentPhotos, type IncomingPhoto } from '@/lib/evidenceServer';
import { createWithCaseNumber, isUniqueViolationOn } from '@/lib/caseNumber';
import { assessCase, priorityToRiskLevel } from '@/lib/caseAssessment';
import { detectLanguageSafe } from '@/lib/detectLanguage';
import { isValidCoordinate } from '@/lib/geo';
import { enforceHardRules } from '@/lib/caseClassification';
import { buildEvidence } from '@/lib/reportEvidence';
import { MAX_UNCLEAR_WORDS, type Transcription } from '@/lib/transcription';
import { INCIDENT_TIME_HINT, isIncidentTime } from '@/lib/incidentTime';
import { runIntake, answersSchema, relationshipSchema, turnsSchema, transcript, NARRATIVE_MAX } from '@/lib/intakeServer';
import { ANONYMOUS_NAME, type InterviewTurn } from '@/lib/interviewTypes';
import { triageStatusFor } from '@/lib/intake';
import {
  REPORT_PATHS, incidentDateSchema, affectedPartySchema, reportedPartySchema, hasPartyDetails,
} from '@/lib/caseRecords';
import { deskFor, deskHistoryRow } from '@/lib/reportDeskServer';
import { DESK_DECISION_LABEL } from '@/lib/reportDesk';
import { draftQuietly } from '@/lib/reportReviewServer';
import { detectForCase } from '@/lib/caseMatchingServer';


/**
 * Fields only the server sets. A report that carries any of them is refused
 * outright rather than quietly stripped, so a client can never believe it set
 * a level, marked an assessment complete, or skipped the sufficiency check.
 */
export const SERVER_ONLY_FIELDS = [
  'riskLevel', 'matrixLevel', 'matrixLabel', 'status', 'triageStatus', 'assessmentStatus', 'classificationStatus',
  'informationCompleteness', 'informationSufficient', 'requiresOfficerReview', 'urgentReview', 'assessment',
  'aiAssessment', 'suggestedCategory', 'assignedToId', 'riskBasis',
  // Officer-only records: never accepted from a resident.
  'reportingChannel', 'safetyAssessment', 'referrals', 'parties',
  // The jurisdiction decision is the server's (lib/jurisdiction.ts checkLocation): a client cannot
  // say a location is inside, or that a submission is or is not a referral.
  'isWithinJurisdiction', 'withinJurisdiction', 'inJurisdiction', 'jurisdictionResult', 'locationCheck', 'locationStatus',
  'outcome', 'referral', 'referralKind', 'referralStatus', 'confidential',
];

export const createSchema = z.object({
  // No longer asked of the resident: the category is derived from what they
  // wrote, by the classification matrix. Accepted from an older client as
  // context only - it never decides the category.
  caseType: z.string().max(120).optional(),
  description: z.string().min(10, 'Description must be at least 10 characters').max(NARRATIVE_MAX + 1000, 'The description is too long'),
  barangay: z.string().optional(),
  additionalNotes: z.string().optional(),
  // How it is safe to reach the reporter. Shown to the official handling the
  // case beside the contact details (lib/reporterAccess.ts).
  contactPreference: z.enum(['call_ok', 'text_first', 'no_phone']).optional(),
  contactSafetyNote: z.string().trim().max(200).optional(),
  // Where it happened, from the map picker. Optional: a report filed without
  // a pin is still a report, and the street field carries the location.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  locationLabel: z.string().max(300).optional().nullable(),
  municipality: z.string().max(120).optional().nullable(),
  province: z.string().max(120).optional().nullable(),
  // Where the incident happened, as the resident chose it - checked against the jurisdiction on the
  // server (lib/jurisdiction.ts). Required: a report with no incident place cannot be placed in or out.
  incidentProvince: z.string().trim().max(80).optional(),
  incidentMunicipality: z.string().trim().max(80).optional(),
  incidentBarangay: z.string().trim().max(80).optional(),
  // A landmark or other details, when the street alone does not say where.
  incidentLocationDetails: z.string().trim().max(300).optional(),
  // The verified street chosen from the list for that place (030). Checked on the server
  // (lib/verifiedStreets.ts) to belong to the barangay given; never needed for a typed street.
  streetId: z.string().trim().max(200).optional(),
  // Whether the form says the street was typed by hand - informational; the server decides it again.
  streetManual: z.boolean().optional(),
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
  // The assisted intake. The narrative is what the resident wrote before any
  // landmark or "other" detail was appended to the description; the answers
  // are re-read here, so nothing computed in the browser is trusted.
  intakeNarrative: z.string().max(NARRATIVE_MAX).optional(),
  intakeAnswers: answersSchema,
  // Who the report is for. Optional only for an older client, which is
  // taken as SELF, as every report was before this was asked.
  reportingRelationship: relationshipSchema.optional(),
  // Who was affected, in the reporter's words - never required.
  affectedPersonNote: z.string().trim().max(200).optional(),
  // The AI interview as asked and answered. The resident's own statements;
  // re-read on the server, never taken as a classification.
  intakeTurns: turnsSchema,
  // Which form they used - Blotter or VAWC. A first reading, like the
  // category below: the report's own content decides, and a disagreement is
  // put to an officer.
  // No longer asked: SafeComm recommends the desk (lib/reportDesk.ts). An
  // older page may still send it; "VAWC" is then one more reason to keep the
  // report confidential - never a reason for less.
  reportPath: z.enum(REPORT_PATHS).optional(),
  // The form's key for this one submission: sent again on a retry, so a lost
  // response or a second tap never files the report - or its photos - twice.
  submissionKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid submission key').optional(),
  // When it happened, if they know. Never required.
  incidentDate: incidentDateSchema,
  // Chosen on the form: a part of the day or an exact time (lib/incidentTime.ts).
  incidentTimeApprox: z.string().trim().max(60).optional().refine(v => isIncidentTime(v), INCIDENT_TIME_HINT),
  witnessInfo: z.string().trim().max(500).optional(),
  // The person affected and the person reported, as far as the reporter
  // knows - each field optional, each person stored on their own, and never
  // matched to a resident record by name.
  affectedParty: affectedPartySchema.optional(),
  reportedParty: reportedPartySchema.optional(),
  // The Reporting Assistant organized the description and the resident chose that version (as
  // suggested, or edited): their own words come too, and are kept beside it. Both or neither.
  residentOriginalNarrative: z.string().trim().min(1).max(NARRATIVE_MAX).optional(),
  narrativeAssist: z.enum(['ACCEPTED', 'EDITED']).optional(),
}).refine(d => Boolean(d.residentOriginalNarrative) === Boolean(d.narrativeAssist), 'Send the original description together with how the organized one was used');

export type ResidentCaseInput = z.infer<typeof createSchema>;

/**
 * File a resident's report as a SafeComm case - the whole pipeline: the
 * assisted intake (rules, then SafeComm AI), the desk recommendation, the
 * risk assessment, the people, the photos, the draft and the duplicate check.
 *
 * Called by POST /api/resident/cases once the server's own location check
 * places the incident inside the jurisdiction, and by the referral review when
 * an official confirms that a location held for verification is inside - the
 * same report, filed as it would have been. The caller has already checked
 * the resident's residency and the incident location.
 */
export async function fileResidentCase(p: {
  residentId: string;
  data: ResidentCaseInput;
  photos: IncomingPhoto[];
  /** How many unclear words the client sent before they were trimmed (an overflow marks the case for a person). */
  unclearWordCount: number;
  /** The location still needs an officer's eye (it is filed, and marked for review). */
  locationReview: boolean;
  /** The street as the server checked it (lib/verifiedStreets.ts resolveIncidentStreet). */
  street?: { streetId: string | null; manual: boolean | null };
}): Promise<Response> {
  const { residentId, data } = p;
  const resident = await prisma.resident.findUnique({
    where: { id: residentId },
    select: { firstName: true, lastName: true, barangay: true, gender: true },
  });
  if (!resident) return rError('Resident not found', 404);

  const photos = p.photos;

  // Already filed with this key (a retry): the same case, not a second one. Any of
  // its photos that did not arrive the first time are added now - never twice.
  const submissionKey = data.submissionKey ?? null;
  const alreadyFiled = async () => {
    const existing = submissionKey ? await prisma.case.findFirst({ where: { residentId: residentId, submissionKey },
      select: { id: true, caseNumber: true, caseType: true, status: true, triageStatus: true, filedAt: true } }) : null;
    if (!existing) return null;
    const photosAdded = await storeResidentPhotos(existing.id, residentId, photos);
    return rSuccess({ ...existing, duplicate: true, photosAdded }, 200);
  };
  const repeat = await alreadyFiled();
  if (repeat) return repeat;

  const barangay = data.barangay || resident.barangay;

  // A pin only counts when both halves are present and in range. Zod has
  // already bounded each one; this is the pairing, so a half-sent location
  // is stored as no location rather than as a point on the equator.
  const pin = isValidCoordinate(data.latitude, data.longitude)
    ? {
        latitude: data.latitude as number,
        longitude: data.longitude as number,
        locationLabel: data.locationLabel ?? null,
        // The place the resident chose (checked above), before what the map provider called it.
        municipality: data.incidentMunicipality || data.municipality || null,
        province: data.incidentProvince || data.province || null,
      }
    : {};
  const filedAt = new Date();

  const { additionalNotes } = data;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // The assisted intake: the resident's own narrative and answers, read by
  // the same grounded rules as before. It decides completeness, the
  // suggested category and the preliminary level - and the level comes from
  // stated facts and the documented hard rules, never from the dropdown.
  const narrative = (data.intakeNarrative ?? '').trim() || data.description;
  const relationship = data.reportingRelationship ?? 'SELF';
  const anonymous = relationship === 'ANONYMOUS';
  const turns = (data.intakeTurns ?? []) as InterviewTurn[];
  // The rules, then one Groq call: the facts and a preliminary assessment
  // against the matrix text retrieved from the knowledge base. On any AI
  // trouble the rules' reading stands alone and the report is still filed.
  const intake = await runIntake({
    residentId: residentId,
    narrative,
    answers: data.intakeAnswers,
    selectedCategory: data.caseType ?? null,
    street: barangay,
    gender: resident.gender ?? null,
    useAi: true,
    residentNames: [resident.firstName, resident.lastName],
    relationship,
    turns,
  });
  const aiAssessment = intake.grounding.ai?.assessment ?? null;
  // Which desk: SafeComm's recommendation from the same reading and both
  // desks' knowledge-base text - never the resident's choice. A possible
  // VAWC concern is filed on the VAWC desk, confidential, whatever else.
  const desk = await deskFor(intake, narrative, true, undefined, data.reportPath === 'VAWC');
  // Where the report stands, from the server's own reading: urgent first,
  // then whether the matrix could be consulted, then whether enough is known.
  // A report with essentials missing is saved - never refused - as
  // NEEDS_FOLLOW_UP, and is not presented as classified.
  const triageStatus = triageStatusFor(intake.result, aiAssessment, intake.grounding.knowledgeBaseStatus === 'unavailable');
  const urgentReview = triageStatus === 'URGENT_REVIEW';

  // The case is filed under the matrix's category - a specific one, or
  // "Other" / "VAWC - Other" when the report does not support one and an
  // officer has to classify it. Which desk can see it follows from this.
  const caseType = intake.result.suggestedCaseCategory;

  const [barangayCaseCount, residentCaseCount, residentSameTypeCount, highRiskAreaCaseCount] = await Promise.all([
    prisma.case.count({ where: { barangay, filedAt: { gte: thirtyDaysAgo } } }),
    prisma.case.count({ where: { residentId: residentId } }),
    prisma.case.count({
      where: { residentId: residentId, caseType },
    }),
    prisma.case.count({
      where: {
        barangay,
        caseType,
        riskLevel: { in: ['High', 'Critical'] },
        filedAt: { gte: thirtyDaysAgo },
      },
    }),
  ]);

  const aiRisk = computeRisk({
    caseType,
    barangay,
    description: data.description,
    filedAt,
    residentId: residentId,
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


  // A photographed document is evidence, but an unclear reading is not: the
  // guard drops any factor that rests on a word the reader was unsure of and
  // marks the case for a person to read the photo.
  // More unclear words than the report carries means the rest were dropped,
  // and a factor could be resting on one of them. The case is still filed;
  // it is marked so a person reads the photo.
  const unclearOverflowed =
    p.unclearWordCount > MAX_UNCLEAR_WORDS;

  const transcription: Transcription | null = data.documentText || data.documentReadFailed
    ? {
        text: data.documentText ?? '',
        confidence: unclearOverflowed ? 'low' : (data.documentConfidence ?? 'medium'),
        fields: [],
        unclearWords: data.documentUnclearWords,
        failed: data.documentReadFailed ?? false,
        ...(unclearOverflowed && {
          message: 'Too much of the attached photo was unclear to rely on, so it needs an officer to read it.',
        }),
      }
    : null;
  const evidence = buildEvidence(data.description, transcription);

  // Which language to answer in, read from what the resident actually typed.
  // The document text is left out of this on purpose: a photographed blotter
  // entry is often written by an officer in English while the resident wrote
  // their own account in Tagalog, and it is the resident who reads the reply.
  const detected = detectLanguageSafe(data.description);


  // A photographed document is still read by the older path, with its
  // unclear-word guard; whichever reading is more serious is kept, because
  // the rules only ever raise.
  const assessment = intake.assessment;
  const docRead = transcription
    ? enforceHardRules(priorityToRiskLevel(assessCase(evidence.classifiedText, {
      priorSameType: residentSameTypeCount, areaRecentSameType: highRiskAreaCaseCount,
      gender: resident.gender ?? null, language: detected.language,
    }).priority), {
      report: evidence.classifiedText,
      unclearWords: data.documentUnclearWords ?? [],
      priorCases: residentSameTypeCount,
      attachments: { photos: photos.length, documents: data.documentText ? 1 : 0 },
    })
    : null;
  const LEVELS = ['Low', 'Medium', 'High', 'Critical'];
  // An undetermined level is set by the document only through a safety rule
  // it triggers - never by the keyword reading's own guess.
  // The same rule as the intake: only a danger or severity rule (H1, H4,
  // H5) - never who is involved - sets a level the matrix did not.
  const docRule = Boolean(docRead?.classification.hard_rules_applied.some(r => r === 'H1' || r === 'H4' || r === 'H5'));
  const current = intake.result.riskLevel;
  const riskLevel = docRead && (current ? LEVELS.indexOf(docRead.level) > LEVELS.indexOf(current) : docRule)
    ? docRead.level : current;
  const classification = docRead?.classification ?? intake.classification;
  const ir = intake.result;

  // Filed under the recommendation's category: the reading's own, or
  // "VAWC - Other" when it is held on the VAWC desk for confidential review.
  // The reading's category stays on the intake record either way, and the
  // recommendation in the case's history.
  const filedType = desk.filedCategory;
  const deskUnsettled = desk.decision === 'NEEDS_CLARIFICATION' || desk.decision === 'HUMAN_REVIEW';
  const deskReason = deskUnsettled ? `${DESK_DECISION_LABEL[desk.decision]}: ${desk.explanation[0]}` : null;

  // Retried: two residents filing at the same moment can be handed the same
  // number, and the unique constraint rejects the loser.
  let newCase;
  try {
    newCase = await createWithCaseNumber('SC', caseNumber =>
    prisma.case.create({
      data: {
        caseNumber,
        submissionKey,
        // Anonymous: officials see no name. The account stays linked so the
        // reporter can follow their own report in My Cases.
        residentName: anonymous ? ANONYMOUS_NAME : `${resident.firstName} ${resident.lastName}`,
        reportingRelationship: relationship,
        affectedPersonNote: relationship === 'SELF' ? null : data.affectedPersonNote || null,
        reporterIdentityWithheld: anonymous,
        caseType: filedType,
        description: data.description,
        // The resident's own words, when they chose the AI-organized version above (never written by the AI).
        residentOriginalNarrative: data.narrativeAssist ? data.residentOriginalNarrative : null,
        narrativeAssist: data.narrativeAssist ?? null,
        barangay,
        status: 'Open',
        riskLevel,
        informationCompleteness: ir.informationCompleteness,
        requiresOfficerReview: ir.requiresOfficerReview || triageStatus !== 'PRELIMINARY' || deskUnsettled || p.locationReview,
        triageStatus,
        language: detected.language,
        // Where it happened, as chosen (030): the barangay, and which street - a verified one, or typed.
        municipality: data.incidentMunicipality || null,
        province: data.incidentProvince || null,
        incidentBarangay: data.incidentBarangay || null,
        streetId: p.street?.streetId ?? null,
        streetManual: p.street?.manual ?? null,
        ...pin,
        filedAt,
        residentId: residentId,
        ...(notesValue && { notes: notesValue }),
        // No way to be contacted is kept for an anonymous report.
        contactPreference: anonymous ? null : data.contactPreference ?? null,
        contactSafetyNote: anonymous ? null : data.contactSafetyNote || null,
        // The resident no longer picks a form - null, unless an older page sent one.
        reportPath: data.reportPath ?? null,
        reportingChannel: 'ONLINE',
        incidentDate: data.incidentDate ? new Date(`${data.incidentDate}T00:00:00Z`) : null,
        incidentTimeApprox: data.incidentTimeApprox || null,
        witnessInfo: data.witnessInfo || null,
      },
    }),
  );
  } catch (err) {
    // The same submission arrived twice at once: the other request filed it.
    if (isUniqueViolationOn(err, 'submissionKey')) {
      const repeatNow = await alreadyFiled();
      if (repeatNow) return repeatNow;
    }
    throw err;
  }
  const caseNumber = newCase.caseNumber;

  // The person affected and the person reported, each a record of its own.
  // Reporting for yourself, you are the person affected: what is asked then
  // is only whether children or dependents are affected.
  const parties = [
    ...(hasPartyDetails(data.affectedParty) ? [{ role: 'AFFECTED', ...data.affectedParty }] : []),
    ...(hasPartyDetails(data.reportedParty) ? [{ role: 'REPORTED', ...data.reportedParty }] : []),
  ];
  if (parties.length) {
    await prisma.caseParty.createMany({ data: parties.map(p => ({ ...p, caseId: newCase.id, source: 'reporter' })) });
  }

  // The resident's photos first, on their own: they are evidence, and they
  // must survive even if the assessment below cannot be written.
  // Stored with who sent them and each one's fingerprint (lib/evidenceServer).
  await storeResidentPhotos(newCase.id, residentId, photos);

  const needsHumanReview = evidence.needsHumanReview || classification.needs_human_review || ir.requiresOfficerReview || deskUnsettled || p.locationReview;
  const reviewReasons = [
    ...evidence.reviewReasons,
    ...(classification.needs_human_review_reason ? [classification.needs_human_review_reason] : []),
    ...ir.reviewReasons,
    ...(deskReason ? [deskReason] : []),
  ].filter((r, i, all) => all.indexOf(r) === i);

  // The level the case was actually stored at, not the one the weighted
  // factors reached on their own: an officer reading the feed has to see the
  // same answer the case carries, and which rules put it there.
  const raised = ir.rulesApplied;
  const activityMsg = `Resident filed case ${caseNumber}: ${filedType}${ir.classificationStatus === 'needs_review' ? ' (needs review)' : ''} — ${riskLevel ? `${riskLevel} risk (preliminary)` : 'risk undetermined'}, triage ${triageStatus.toLowerCase().replace(/_/g, ' ')}, `
    + `information ${ir.informationCompleteness.toLowerCase().replace(/_/g, ' ')}`
    + `${raised.length ? ` (rule ${raised.join(', ')})` : ''}`
    + `${aiRisk.highRiskZone ? ' ⚠ HIGH-RISK ZONE' : ''}`;

  /**
   * Everything the assessment produced, written together or not at all. A
   * failure here must not cost the resident their report: the case above is
   * already filed, so it is kept, marked for a person, and the resident is
   * still given their case number.
   */
  let assessmentSaved = true;
  try {
    await prisma.$transaction([
      prisma.caseAssessment.create({
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
            missingInformation: ir.missingInformation,
            language: detected.language,
            languageConfidence: detected.confidence,
            languageCounts: { tagalog: detected.tagalogCount, english: detected.englishCount },
            barangayMessage: assessment.barangayMessage,
            frequency: assessment.analysis.frequency,
            escalation: assessment.analysis.escalation,
            needsHumanReview,
            reviewReasons,
            informationCompleteness: ir.informationCompleteness,
            riskBasis: ir.riskBasis,
            riskRationale: ir.riskRationale,
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
            documentText: data.documentText ?? null,
            documentConfidence: data.documentConfidence ?? null,
          })),
        },
      }),
      prisma.caseIntake.create({
        data: {
          caseId: newCase.id,
          narrative,
          selectedCategory: data.caseType ?? null,
          language: detected.language,
          turns: JSON.parse(JSON.stringify(transcript(data.intakeAnswers, ir))),
          informationCompleteness: ir.informationCompleteness,
          suggestedCaseCategory: ir.suggestedCaseCategory,
          classificationStatus: ir.classificationStatus,
          officerToConfirm: ir.officerToConfirm,
          matrixVersion: ir.matrixVersion,
          categoryConfidence: ir.categoryConfidence,
          categoryRationale: ir.categoryRationale,
          conflicts: ir.conflicts,
          route: ir.route,
          immediateSafetyConcern: ir.immediateSafetyConcern,
          supportingIndicators: JSON.parse(JSON.stringify(ir.supportingIndicators)),
          missingInformation: ir.missingInformation,
          recommendedNextSteps: ir.recommendedNextSteps,
          requiresOfficerReview: needsHumanReview,
          reviewReasons,
          engineVersion: ir.engineVersion,
          framework: ir.framework,
          matrixLevel: ir.matrixLevel,
          matrixLabel: ir.matrixLabel,
          matchedCriteria: JSON.parse(JSON.stringify(ir.matchedCriteria)),
          assessmentStatus: ir.assessmentStatus,
          alternativeCategories: ir.alternativeCategories,
          levelCaveats: ir.levelCaveats,
          matrixReferences: JSON.parse(JSON.stringify(intake.grounding.references)),
          sourceVerified: intake.grounding.sourceVerified,
          knowledgeBaseStatus: intake.grounding.knowledgeBaseStatus,
          assessedBy: intake.grounding.assessedBy,
          ...(intake.grounding.ai && {
            aiReading: JSON.parse(JSON.stringify({
              status: intake.grounding.ai.status,
              used: intake.grounding.ai.used,
              model: intake.grounding.ai.model,
              version: intake.grounding.ai.version,
              note: intake.grounding.ai.note,
              category: intake.grounding.ai.hints?.category ?? null,
              categoryConfidence: intake.grounding.ai.hints?.categoryConfidence ?? null,
              alternativeCategories: intake.grounding.ai.hints?.alternativeCategories ?? [],
              facts: intake.grounding.ai.hints?.facts ?? [],
              slots: intake.grounding.ai.hints?.slots ?? [],
              reasons: intake.grounding.ai.reasons,
              dropped: intake.grounding.ai.dropped,
              // The preliminary assessment against the retrieved matrix
              // text, with its sources by id - separate from the facts.
              assessment: aiAssessment,
            })),
          }),
          // Every interview question as asked, with the answer or how it was
          // left - kept exactly, beside the original narrative above.
          aiInterview: JSON.parse(JSON.stringify({ relationship, turns, rounds: Math.max(0, ...turns.map(t => t.round)) })),
          urgentReview,
        },
      }),
      // The desk recommendation as made, kept apart from the risk assessment below.
      prisma.assessmentHistory.create({ data: deskHistoryRow(newCase.id, desk, filedType) }),
      prisma.assessmentHistory.create({
        data: {
          caseId: newCase.id,
          kind: 'preliminary',
          riskLevel,
          caseType: filedType,
          framework: ir.framework,
          matrixLevel: ir.matrixLevel,
          matrixLabel: ir.matrixLabel,
          informationCompleteness: ir.informationCompleteness,
          rationale: JSON.parse(JSON.stringify({
            basis: ir.riskBasis, status: ir.assessmentStatus, why: ir.riskRationale,
            criteria: ir.matchedCriteria.map(m => `L${m.level} ${m.indicator}`),
            sourceVerified: intake.grounding.sourceVerified,
            // What it was assessed with, so an officer's later decision can be
            // compared with it: the model, the matrix version, the passages.
            model: intake.grounding.ai?.used ? intake.grounding.ai.model : null,
            aiLevel: aiAssessment?.level ?? null,
            aiCriteria: (aiAssessment?.criteria ?? []).map(c => `L${c.level} ${c.criterion}`),
            matrixVersions: intake.grounding.matrixVersions ?? [],
            references: intake.grounding.references.map(x => ({ section: x.sectionTitle, level: x.riskLevel, page: x.pageNumber })),
          })),
          engineVersion: ir.engineVersion,
        },
      }),
      prisma.activity.create({
        data: {
          type: 'case_filed',
          message: activityMsg,
          entityId: newCase.id,
          entityType: 'Case',
          caseId: newCase.id,
          color: riskLevel === 'Critical' ? '#8b5cf6'
            : riskLevel === 'High' ? '#ef4444'
              : riskLevel === 'Medium' ? '#f97316' : riskLevel === 'Low' ? '#14b8a6' : '#64748b',
        },
      }),
      // A safety concern goes to the desks at once, through the existing
      // notification feed - which already withholds a VAWC case from anyone
      // not entitled to it. The notice names no one and quotes nothing.
      ...(ir.immediateSafetyConcern ? [prisma.notification.create({
        data: {
          title: `Safety concern in new report ${caseNumber}`,
          message: 'A resident reported an immediate safety concern. Open the case to review it now.',
          type: 'error',
          userId: null,
          caseId: newCase.id,
        },
      })] : urgentReview ? [prisma.notification.create({
        data: {
          title: `Urgent review recommended for ${caseNumber}`,
          message: 'The preliminary AI assessment recommends urgent human review. Open the case to check it.',
          type: 'warning',
          userId: null,
          caseId: newCase.id,
        },
      })] : []),
    ]);
  } catch (err) {
    assessmentSaved = false;
    console.error('[Resident case create] assessment not saved', err instanceof Error ? err.message : 'failed');
    await prisma.case.update({
      where: { id: newCase.id },
      data: { requiresOfficerReview: true },
    }).catch(() => undefined);
  }

  // AI-Assisted Report Standardization: a first draft in the desk's template
  // from what the case records - no AI call, so filing never waits or fails
  // on it - then SafeComm AI organizes the resident's words after the
  // response. Neither touches the narrative, the category or the level.
  await draftQuietly(newCase.id, { useAi: false, by: { residentId: residentId }, chargeTo: residentId, reason: 'Filed by the resident' });
  try {
    after(async () => { await draftQuietly(newCase.id, { useAi: true, by: { residentId: residentId }, chargeTo: residentId, reason: 'Organized after filing' }); });
  } catch { /* outside a request (tests): the records-only draft stands; the cron retries */ }
  // Duplicate and related case detection, after the response: filing never
  // waits on it, and a failure leaves the report exactly as filed (the
  // check is recorded as failed and an official can run it again).
  try {
    after(async () => {
      await detectForCase(newCase.id).catch(e => console.error('[Resident case create] duplicate check failed', e instanceof Error ? e.message : 'failed'));
    });
  } catch { /* outside a request (tests): the tests run the check themselves */ }

  return rSuccess({
    ...newCase,
    aiRiskAssessment: aiRisk,
    assessment,
    intake: ir,
    assessmentSaved,
    needsHumanReview,
    reviewReasons,
    classification,
    // For the resident: where it stands and what would help - never which
    // desk by name, since a screen can be seen by someone else.
    desk: {
      decision: desk.decision, confidentialReview: desk.confidentialReview, clarificationNeeded: desk.clarificationNeeded,
      questions: desk.questions, awaitingAi: desk.awaitingAi,
    },
  }, 201);
}
