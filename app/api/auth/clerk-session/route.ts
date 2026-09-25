import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { signResidentToken, setResidentCookie, rSuccess, rError } from '@/lib/residentAuth';

/**
 * Exchanges a signed-in Clerk session for the app's existing resident_token.
 *
 * Clerk owns identity and email verification; every resident page and
 * /api/resident/* route still reads resident_token, so this bridge keeps them
 * working untouched instead of rewriting the whole portal.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return rError('Not signed in with Clerk', 401);

    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;

    // Match on clerkId first; fall back to email so residents who registered
    // before Clerk get linked on their first Clerk sign-in.
    let resident = await prisma.resident.findFirst({
      where: { clerkId: userId },
      select: { id: true, firstName: true, lastName: true, email: true, status: true, residentNumber: true },
    });

    if (!resident && email) {
      const byEmail = await prisma.resident.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (byEmail) {
        resident = await prisma.resident.update({
          where: { id: byEmail.id },
          // Clerk verified the address to issue this session.
          data: { clerkId: userId, emailVerified: true },
          select: { id: true, firstName: true, lastName: true, email: true, status: true, residentNumber: true },
        });
      }
    }

    if (!resident) {
      return NextResponse.json(
        {
          success: false,
          error: 'No resident profile is linked to this account yet.',
          code: 'PROFILE_INCOMPLETE',
        },
        { status: 404 },
      );
    }

    const name = `${resident.firstName} ${resident.lastName}`;
    const token = signResidentToken({
      residentId: resident.id,
      email: resident.email ?? email ?? '',
      name,
      role: 'resident',
    });

    const res = rSuccess({
      resident: {
        id: resident.id, name, email: resident.email,
        status: resident.status, residentNumber: resident.residentNumber,
      },
    });
    setResidentCookie(res as NextResponse, token);
    return res;
  } catch (err) {
    console.error('[Clerk Session]', err);
    return rError('Server error', 500);
  }
}
