import { z } from 'zod';

/** A saved KP form as the API accepts it: the case's shared values and this form's own. Bounded so a record stays a form. */
export const kpData = z.object({
  shared: z.object({
    caseNo: z.string().max(60), paraSa: z.string().max(300),
    complainants: z.array(z.string().max(200)).max(20), respondents: z.array(z.string().max(200)).max(20),
    punongBarangay: z.string().max(120),
  }),
  form: z.record(z.string(), z.unknown()),
}).refine(d => JSON.stringify(d).length <= 60_000, 'The form is too long to save.');
