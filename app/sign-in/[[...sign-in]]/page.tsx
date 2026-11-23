import { redirect } from 'next/navigation';

/** The old Clerk sign-in address. Residents sign in at /resident-login (Supabase Auth). */
export default function OldSignInPage() {
  redirect('/resident-login');
}
