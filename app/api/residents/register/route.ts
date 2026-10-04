import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { successResponse, errorResponse } from '@/lib/auth';
import { issueVerificationToken } from '@/lib/verification';
import { sendVerificationEmail } from '@/lib/email';
import { missingRequired, checkDatabase } from '@/lib/configCheck';
import { GENDER_OPTIONS, GENDER_UNDISCLOSED } from '@/lib/safecommConfig';

const registerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  age: z.coerce.number().int().min(1, 'Age must be at least 1').max(120, 'Invalid age'),
  // The same list the form offers, and optional because the form says it is.
  // This accepted only Male, Female and Other, so a resident who picked
  // "Prefer not to say" was told to select a gender they had just selected.
  gender: z.enum(GENDER_OPTIONS).optional().or(z.literal('')),
  barangay: z.string().min(2, 'Please enter your barangay'),
  address: z.string().min(5, 'Please enter your full address'),
  contactNumber: z.string().regex(/^09\d{9}$/, 'Contact number must be 11 digits starting with 09'),
  email: z.string().email('Please enter a valid email address'),
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,20}$/, 'Username must be 3–20 characters (letters, numbers, . _ -)'),
  // Optional: when Clerk owns the credentials there is no password to store.
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  idDocument: z.string().optional(),
});

/** Next unissued resident number for the current year. */
async function nextResidentNumber(): Promise<string> {
  const prefix = `RES-${new Date().getFullYear()}-`;
  const latest = await prisma.resident.findFirst({
    where: { residentNumber: { startsWith: prefix } },
    orderBy: { residentNumber: 'desc' },
    select: { residentNumber: true },
  });
  const highest = latest ? Number(latest.residentNumber.slice(prefix.length)) : 0;
  const next = (Number.isFinite(highest) ? highest : 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/** Prisma's unique-constraint error, and which field tripped it. */
function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return null;
  const target = Array.isArray(e.meta?.target) ? e.meta.target.join(',') : String(e.meta?.target ?? '');
  return target;
}

export async function POST(req: NextRequest) {
  const misconfigured = missingRequired();
  if (misconfigured) return errorResponse(misconfigured, 503);

  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);
    }

    const { firstName, lastName, age, gender, barangay, address, contactNumber, email, username, password, idDocument } = parsed.data;

    const existing = await prisma.resident.findFirst({ where: { email } });
    if (existing) return errorResponse('An account with this email already exists', 409);

    // Usernames are matched case-insensitively at login, so reserve them that way.
    const usernameTaken = await prisma.resident.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (usernameTaken) return errorResponse('That username is already taken', 409);

    // Numbering used to be `count + 1`, which collides the moment any resident
    // is deleted: with 00002/00003/00005 on file the count is 3 and the next
    // number computes to 00004 — but after another deletion it lands on one
    // that already exists, and residentNumber is unique. Take the highest
    // number actually issued this year instead. The suffix is zero-padded, so
    // ordering by the string is the same as ordering numerically.
    const residentNumber = await nextResidentNumber();

    // When Clerk created the account it already verified the email and owns the
    // credentials, so there is no local password to hash.
    const { userId: clerkId } = await auth();
    const hashed = password ? await bcrypt.hash(password, 12) : null;

    if (!clerkId && !hashed) {
      return errorResponse('A password is required', 400);
    }

    // Two people finishing their profile at the same moment can compute the
    // same number, so retry on that specific collision rather than failing.
    let resident;
    let number = residentNumber;
    for (let attempt = 0; ; attempt++) {
      try {
        resident = await prisma.resident.create({
          data: {
            residentNumber: number,
            firstName,
            lastName,
            age,
            gender: gender || GENDER_UNDISCLOSED,
            barangay,
            address,
            contactNumber,
            email,
            username,
            clerkId: clerkId ?? null,
            password: hashed,
            idDocument: idDocument ?? null,
            status: 'Pending',
            riskLevel: 'Low',
            emailVerified: Boolean(clerkId),
          },
          select: {
            id: true, residentNumber: true, firstName: true, lastName: true,
            email: true, status: true, registeredAt: true,
          },
        });
        break;
      } catch (err) {
        const field = uniqueViolation(err);
        if (field === null) throw err;

        // Say which field clashed instead of a blanket "Server error".
        if (field.includes('username')) {
          return errorResponse('That username is already taken', 409);
        }
        if (field.includes('clerkId')) {
          return errorResponse('This account already has a resident profile.', 409);
        }
        if (field.includes('residentNumber') && attempt < 5) {
          number = await nextResidentNumber();
          continue;
        }
        throw err;
      }
    }

    await prisma.activity.create({
      data: {
        type: 'resident_registered',
        message: `New resident self-registered: ${firstName} ${lastName} (${resident.residentNumber})`,
        entityId: resident.id,
        entityType: 'Resident',
        color: '#14b8a6',
      },
    });

    // Clerk already verified the address before issuing the session, so the
    // legacy token + SMTP path only runs for non-Clerk registrations.
    if (clerkId) {
      return successResponse({ ...resident, emailSent: true, emailReason: 'clerk_verified' }, 201);
    }

    // Email delivery must never roll back a created account — the UI offers a resend.
    const rawToken = await issueVerificationToken(resident.id);
    const send = await sendVerificationEmail(
      email, `${firstName} ${lastName}`, rawToken, req.nextUrl.origin,
    );

    return successResponse(
      { ...resident, emailSent: send.ok, emailReason: send.reason, emailDetail: send.detail },
      201,
    );
  } catch (err) {
    // Log the real cause so it reaches the hosting provider's function logs.
    console.error('[Resident register]', err);

    const field = uniqueViolation(err);
    if (field) {
      return errorResponse(`That ${field.includes('username') ? 'username' : 'detail'} is already in use`, 409);
    }

    const db = await checkDatabase();
    if (!db.ok) {
      return errorResponse(
        `Cannot reach the database (${db.reason}). Check DATABASE_URL in your hosting environment variables.`,
        503,
      );
    }
    return errorResponse('Could not save your profile. Please try again.', 500);
  }
}
