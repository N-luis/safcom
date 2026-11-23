import { redirect } from 'next/navigation';

/** The old Clerk sign-up address. Registration is at /register (Supabase Auth). */
export default function OldSignUpPage() {
  redirect('/register');
}
