import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { successResponse, errorResponse } from '@/lib/auth';
import { issueVerificationToken } from '@/lib/verification';
import { sendVerificationEmail } from '@/lib/email';

const registerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  age: z.coerce.number().int().min(1, 'Age must be at least 1').max(120, 'Invalid age'),
  gender: z.enum(['Male', 'Female', 'Other'], { error: 'Please select a gender' }),
  barangay: z.string().min(2, 'Please enter your barangay'),
  address: z.string().min(5, 'Please enter your full address'),
  contactNumber: z.string().regex(/^09\d{9}$/, 'Contact number must be 11 digits starting with 09'),
  email: z.string().email('Please enter a valid email address'),
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,20}$/, 'Username must be 3–20 characters (letters, numbers, . _ -)'),
  // Optional: when Clerk owns the credentials there is no password to store.
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  idDocument: z.string().optional(),
});

export async function POST(req: NextRequest) {
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

    const count = await prisma.resident.count();
    const year = new Date().getFullYear();
    const residentNumber = `RES-${year}-${String(count + 1).padStart(5, '0')}`;

    // When Clerk created the account it already verified the email and owns the
    // credentials, so there is no local password to hash.
    const { userId: clerkId } = await auth();
    const hashed = password ? await bcrypt.hash(password, 12) : null;

    if (!clerkId && !hashed) {
      return errorResponse('A password is required', 400);
    }

    const resident = await prisma.resident.create({
      data: {
        residentNumber,
        firstName,
        lastName,
        age,
        gender,
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

    await prisma.activity.create({
      data: {
        type: 'resident_registered',
        message: `New resident self-registered: ${firstName} ${lastName} (${residentNumber})`,
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
  } catch {
    return errorResponse('Server error', 500);
  }
}
