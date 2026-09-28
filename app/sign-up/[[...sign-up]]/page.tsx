import { SignUp } from "@clerk/nextjs";

/**
 * Resident sign-up. See the sign-in page for why the redirect is hardcoded
 * rather than read from NEXT_PUBLIC_CLERK_*_REDIRECT_URL.
 */
const AFTER_AUTH = "/complete-profile";

export default function SignUpPage() {
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

      <p className="mb-6 text-sm text-[#64748b]">Create your resident account</p>

      <SignUp
        forceRedirectUrl={AFTER_AUTH}
        signInForceRedirectUrl={AFTER_AUTH}
      />
    </div>
  );
}
