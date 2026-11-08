/**
 * What a new Annex B referral form starts with, from what the case already
 * records - for the official to check and change before saving. Never a
 * guess: a blank stays blank, to be filled in or left as a line on the form.
 */
import { prisma } from './prisma';
import { BARANGAY_CONTEXT, EMERGENCY_CONTACTS } from './safecommConfig';
import { ROLE_TITLE } from './officialIntake';
import { isVawcType } from './reportingStats';
import { EMPTY_REFERRAL_FORM, CLIENT_SEX, type ReferralFormKey } from './referralForm';

const SEX_OF: Record<string, string> = { female: 'Female', male: 'Male', intersex: 'Intersex' };

export async function referralPrefill(caseId: string, actor: { id: string; role: string }) {
  const [c, me] = await Promise.all([
    prisma.case.findUnique({ where: { id: caseId }, select: {
      caseNumber: true, caseType: true, reportingRelationship: true, reporterIdentityWithheld: true, municipality: true, province: true,
      resident: { select: { firstName: true, lastName: true, age: true, gender: true, address: true } },
      parties: { where: { role: 'AFFECTED' }, select: { source: true, fullName: true, age: true, address: true }, orderBy: { createdAt: 'asc' } },
      victimSurvivors: { where: { removedAt: null }, select: { sexAtBirth: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    } }),
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }),
  ]);
  if (!c) return null;
  const f: Record<ReferralFormKey, string> = { ...EMPTY_REFERRAL_FORM };
  const from: Partial<Record<ReferralFormKey, string>> = {};
  const set = (k: ReferralFormKey, v: string | number | null | undefined, source: string) => {
    if (v === null || v === undefined || String(v).trim() === '') return;
    f[k] = String(v).trim(); from[k] = source;
  };

  // The client: the person affected. Reporting about themselves (and not
  // anonymously), that is the reporter, from their own account.
  const self = (c.reportingRelationship ?? 'SELF') === 'SELF';
  const party = c.parties.find(p => p.source === 'official') ?? c.parties[0] ?? null;
  if (self && !c.reporterIdentityWithheld && c.resident) {
    set('clientName', `${c.resident.firstName} ${c.resident.lastName}`, "the reporter's account");
    set('clientAge', c.resident.age, "the reporter's account");
    set('clientAddress', c.resident.address, "the reporter's account");
    if ((CLIENT_SEX as readonly string[]).includes(c.resident.gender)) set('clientSex', c.resident.gender, "the reporter's account");
  } else if (party) {
    const src = party.source === 'official' ? "the official's record of the person affected" : "the reporter's account of the person affected";
    set('clientName', party.fullName, src);
    set('clientAge', party.age, src);
    set('clientAddress', party.address, src);
  }
  // Sex as an official recorded it on a VAWC case wins over anything else.
  const sex = c.victimSurvivors[0]?.sexAtBirth;
  if (sex && SEX_OF[sex]) set('clientSex', SEX_OF[sex], 'the victim-survivor record');

  // The referring party: this barangay, and the official making the referral.
  const desk = isVawcType(c.caseType) ? 'VAWC Desk' : 'Blotter Desk';
  set('feedbackTo', `Barangay ${BARANGAY_CONTEXT.name} - ${desk}`, 'the barangay');
  set('feedbackAddress', `Barangay ${BARANGAY_CONTEXT.name}, ${c.municipality || 'Bocaue'}, ${c.province || 'Bulacan'}`, 'the barangay');
  set('feedbackCellPhone', EMERGENCY_CONTACTS.find(x => /barangay hall/i.test(x.label))?.number, "the barangay hall's configured number");
  set('feedbackContact', me?.name, 'you');
  set('referredByName', me?.name, 'you');
  set('referredByDesignation', ROLE_TITLE[actor.role], 'your role');
  return { form: f, from, caseNumber: c.caseNumber };
}
