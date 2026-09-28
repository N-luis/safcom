import { SignIn } from "@clerk/nextjs";

/**
 * Resident sign-in.
 *
 * The redirect is set here rather than left to NEXT_PUBLIC_CLERK_*_REDIRECT_URL.
 * Those are inlined at build time, so a deployment built before the variables
 * existed carried no redirect at all and Google sign-in landed on "/" (which
 * bounces to the staff login). `forceRedirectUrl` is literal in the bundle and
 * takes precedence over environment variables and search params, so every
 * route into the app — email, Google, or any other provider — ends up at
 * /complete-profile. That page bridges the Clerk session to a resident_token
 * and forwards anyone who already has a profile straight to /resident.
 */
const AFTER_AUTH = "/complete-profile";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f7fb] px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a7c6b] to-[#14b8a6]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z" />
          </svg>
        </span>
        <span className="text-xl font-extrabold tracking-tight text-[#0c1e46]">SafeComm</span>
      </div>

      <p className="mb-6 text-sm text-[#64748b]">Resident sign in</p>

      <SignIn
        forceRedirectUrl={AFTER_AUTH}
        signUpForceRedirectUrl={AFTER_AUTH}
      />
    </div>
  );
}
