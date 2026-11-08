/**
 * A victim-survivor record on a VAWC case, as an official enters it - for the
 * women-and-children statistics. What can be entered, and how it is stored.
 * No name, address or contact detail: those stay in the VAWC intake form.
 */
import { z } from 'zod';
import { normalizeClientCode } from './reportingStats';

const todayPh = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export const SEX_AT_BIRTH = { female: 'Female', male: 'Male', intersex: 'Intersex' } as const;

export const victimSurvivorSchema = z.object({
  sexAtBirth: z.enum(['female', 'male', 'intersex']).nullable().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker for the birthdate').nullable().optional()
    .refine(v => !v || (v <= todayPh() && v >= '1900-01-01'), 'The birthdate cannot be in the future'),
  ageAtIncident: z.union([z.number(), z.string()]).nullable().optional()
    .transform(v => (v === null || v === undefined || v === '' ? null : Number(v)))
    .refine(v => v === null || (Number.isInteger(v) && v >= 0 && v <= 120), 'Age must be a whole number from 0 to 120'),
  clientCode: z.string().trim().max(40, 'Keep the client code under 40 characters').nullable().optional(),
  source: z.enum(['official', 'intake']).default('official'),
});
export type VictimSurvivorInput = z.infer<typeof victimSurvivorSchema>;

export function victimSurvivorData(d: VictimSurvivorInput) {
  return {
    sexAtBirth: d.sexAtBirth ?? null,
    birthDate: d.birthDate ? new Date(`${d.birthDate}T00:00:00Z`) : null,
    // A birthdate gives the age at the incident; a typed age is kept only without one.
    ageAtIncident: d.birthDate ? null : d.ageAtIncident ?? null,
    clientCode: normalizeClientCode(d.clientCode),
  };
}

export function victimRow(r: { id: string; sexAtBirth: string | null; birthDate: Date | null; ageAtIncident: number | null; clientCode: string | null;
  source: string; createdAt: Date; updatedAt: Date; removedAt: Date | null; removedReason: string | null }) {
  return {
    id: r.id, sexAtBirth: r.sexAtBirth, birthDate: r.birthDate ? r.birthDate.toISOString().slice(0, 10) : null, ageAtIncident: r.ageAtIncident,
    clientCode: r.clientCode, source: r.source, createdAt: r.createdAt, updatedAt: r.updatedAt, removedAt: r.removedAt, removedReason: r.removedReason,
  };
}
