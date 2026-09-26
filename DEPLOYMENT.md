# Deploying SafeComm to Vercel

The build already succeeds. If the deployed site shows a blank page with the
text **`Internal Server Error`**, the cause is almost always the same: the
environment variables are missing on Vercel.

## Why a missing variable takes the whole site down

`proxy.ts` (the Next.js middleware) runs on every request:

```ts
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

It is wrapped in `clerkMiddleware()`, which throws if the Clerk keys are absent.
Because middleware runs before any page, the crash happens before Next can
render even an error page — hence the bare `Internal Server Error` with no
styling. `next build` does **not** execute middleware, which is why the build
passes and the site still fails.

## Set the environment variables

1. Open **vercel.com → your project → Settings → Environment Variables**.
2. Tick **Production**, **Preview** and **Development**.
3. Vercel accepts a bulk paste: open your local `.env`, copy the whole file,
   and paste it into the key field — it splits the pairs automatically.
   Otherwise add them one at a time from the list below.
4. **Redeploy.** Existing deployments do not pick up new variables. Use
   Deployments → ⋯ → **Redeploy**, and untick "Use existing build cache".

### Required

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API keys. Without it every route 500s |
| `CLERK_SECRET_KEY` | Same page. Without it every route 500s |
| `DATABASE_URL` | Supabase **transaction pooler** URL, port `6543` |
| `JWT_SECRET` | Long random string; signs staff and resident sessions |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/complete-profile` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/complete-profile` |

### Not needed on Vercel

- `DATABASE_DIRECT_URL` — only read by `prisma.config.ts` for CLI migrations.
- `EMAIL_*` — only the pre-Clerk email verification path uses these.

See `.env.example` for the full annotated list.

## Use the pooler, not the direct database host

Serverless functions open a connection per invocation. The direct Supabase host
(`db.<project>.supabase.co:5432`) will exhaust connections, and on newer
projects is not reachable over IPv4 from Vercel.

Use the pooler host (`…pooler.supabase.com:6543`). If you see connection-limit
errors under load, append:

```
?pgbouncer=true&connection_limit=1
```

## Clerk: allow the production domain

Clerk keys are per-instance. In the Clerk dashboard add the Vercel domain
(`your-project.vercel.app`) to the allowed origins / domains for that instance,
or resident sign-in will fail even though the pages render. If you created a
separate production Clerk instance, use its `pk_live_…` / `sk_live_…` keys on
Vercel rather than the `pk_test_…` pair.

## Database schema

The schema is currently applied with `prisma db push` rather than migrations —
the repository contains only the initial migration. The Supabase database is
already up to date, so no migration step runs during deploy. If you later add
fields, run `npx prisma db push` locally against `DATABASE_DIRECT_URL` before
deploying the code that depends on them.

## Checklist for a green deploy

- [ ] All eight required variables set, for all three environments
- [ ] `DATABASE_URL` uses port `6543`
- [ ] `JWT_SECRET` set to a fresh random value
- [ ] Vercel domain added in the Clerk dashboard
- [ ] Redeployed **without** the build cache
- [ ] Open `/login` — the landing page should render, not plain text
