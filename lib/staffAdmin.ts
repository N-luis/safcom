import { NextResponse } from 'next/server';
import { loadActor } from './reporterAccess';

/**
 * Who may manage officials' accounts - create one, change a role or a
 * password, deactivate or reactivate: the Barangay Captain and the system
 * administrator. Read from the database on every request, never from the
 * token, so a role taken away a minute ago no longer counts. Officials edit
 * their own profile through /api/auth/me, which cannot change a role or a
 * password.
 */
export const STAFF_ADMIN_ROLES = ['admin', 'system_admin'];

export async function requireStaffAdmin(userId: string): Promise<NextResponse | null> {
  const actor = await loadActor(userId);
  if (!actor?.active) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!STAFF_ADMIN_ROLES.includes(actor.role.trim())) {
    return NextResponse.json({ success: false, error: 'Only the Barangay Captain or the system administrator can manage staff accounts.' }, { status: 403 });
  }
  return null;
}
