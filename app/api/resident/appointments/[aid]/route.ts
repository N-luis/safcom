import { NextRequest } from 'next/server';
import { requireResidentAuth } from '@/lib/residentAuth';

/**
 * Retired: VAWC Appointments were merged into the hearing workflow, which
 * VAWC cases now share with blotter cases. The appointment records stay,
 * read-only, for one release (each one migrated is linked from its hearing:
 * CaseHearing.migratedFromAppointmentId). Nothing is written here any more -
 * a hearing is created with POST /api/cases/:id/hearings.
 */
export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  return Response.json({
    success: false, code: 'appointments_retired',
    error: 'Appointments are now shown with your hearings in My Hearings & Notices. Acknowledge it or ask for a new date there - nothing was saved here.',
    use: 'POST /api/resident/hearings/:hearingId',
  }, { status: 410, headers: { 'Cache-Control': 'no-store, private' } });
}
