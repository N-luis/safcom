import { NextRequest } from 'next/server';
import { z } from 'zod';
import { consumeVerificationToken } from '@/lib/verification';
import { rSuccess, rError } from '@/lib/residentAuth';

const schema = z.object({ token: z.string().min(1, 'Missing verification token') });

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return rError('Missing verification token', 400);

    const result = await consumeVerificationToken(parsed.data.token);

    switch (result.status) {
      case 'success':
        return rSuccess({ status: 'success', name: result.name, email: result.email });
      case 'already_verified':
        return rSuccess({ status: 'already_verified' });
      case 'expired':
        return rError('expired', 410);
      default:
        return rError('invalid', 400);
    }
  } catch (err) {
    console.error('[Verify Email]', err);
    return rError('Server error', 500);
  }
}
