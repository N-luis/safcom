import { redirect } from 'next/navigation';

/**
 * The old second step after a Clerk sign-up. Registration now collects the
 * profile, the address and the home location in one step at /register, and
 * a resident from before completes their residency at /resident/residency.
 */
export default function OldCompleteProfilePage() {
  redirect('/register');
}
