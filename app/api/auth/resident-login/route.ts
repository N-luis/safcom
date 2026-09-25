import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signResidentToken, setResidentCookie, rSuccess, rError } from '@/lib/residentAuth';
import { identifierWhere } from '@/lib/identifier';

const schema = z.object({
  // Accepts an email address or a username.
  email: z.string().min(1, 'Enter your email or username'),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Invalid body', 400);

    const { email: identifier, password } = parsed.data;

    const resident = await prisma.resident.findFirst({
      where: identifierWhere(identifier),
      select: {
        id: true, firstName: true, lastName: true, email: true,
        password: true, status: true, residentNumber: true, emailVerified: true,
      },
    });

    if (!resident || !resident.password) return rError('Invalid email/username or password', 401);

    const valid = await bcrypt.compare(password, resident.password);
    if (!valid) return rError('Invalid email/username or password', 401);

    // Only revealed after the password checks out, so this can't be used to
    // probe which addresses are registered.
    if (!resident.emailVerified) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please verify your email address before logging in.',
          code: 'EMAIL_NOT_VERIFIED',
        },
        { status: 403 },
      );
    }

    const name = `${resident.firstName} ${resident.lastName}`;
    const token = signResidentToken({ residentId: resident.id, email: resident.email ?? '', name, role: 'resident' });

    const res = rSuccess({
      resident: { id: resident.id, name, email: resident.email, status: resident.status, residentNumber: resident.residentNumber },
    });
    setResidentCookie(res as NextResponse, token);
    return res;
  } catch (err) {
    console.error('[Resident Login]', err);
    return rError('Server error', 500);
  }
}
