/**
 * Account reconciliation - READ ONLY. Compares every Resident profile with the Supabase Auth users
 * and says which state each is in (linked, waiting for its link, no sign-in yet, broken link).
 * Changes nothing; prints masked emails only.   npm run accounts:reconcile
 */
// Read-only: compares Resident profiles with Supabase Auth users. Prints masked emails only.
import { prisma } from '../lib/prisma';
import { createClient } from '@supabase/supabase-js';

const mask = (e: string | null) => {
  if (!e) return '(none)';
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}***@${d ?? '?'}`;
};

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!.trim(),
    { auth: { persistSession: false, autoRefreshToken: false } });
  const users: { id: string; email?: string; email_confirmed_at?: string | null; created_at: string; invited_at?: string | null; last_sign_in_at?: string | null }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  const residents = await prisma.resident.findMany({
    select: { id: true, email: true, supabaseUserId: true, clerkId: true, password: true, emailVerified: true, residencyStatus: true, status: true, registeredAt: true,
      _count: { select: { cases: true } } },
    orderBy: { registeredAt: "asc" },
  });
  const byId = new Map(users.map(u => [u.id, u]));
  const byEmail = new Map(users.filter(u => u.email).map(u => [u.email!.toLowerCase(), u]));
  const rows = residents.map(r => {
    const em = r.email?.trim().toLowerCase() ?? null;
    const linked = r.supabaseUserId ? byId.get(r.supabaseUserId) : undefined;
    const sameEmail = em ? byEmail.get(em) : undefined;
    let state: string;
    if (r.supabaseUserId && !linked) state = 'BROKEN: linked id has no Auth user';
    else if (linked && linked.email?.toLowerCase() !== em) state = 'BROKEN: linked Auth user has a different email';
    else if (linked) state = linked.email_confirmed_at ? 'linked + confirmed' : 'linked, email NOT confirmed';
    else if (sameEmail) state = sameEmail.email_confirmed_at ? 'Auth user exists (confirmed), not linked yet - links at next sign-in' : 'Auth user exists (unconfirmed/invited), not linked - waits for its link';
    else if (!em) state = 'no email on profile - office-assisted only';
    else state = 'NO Auth identity - needs set-up link (Forgot Password)';
    return { resident: r.id.slice(0, 8), email: mask(em), origin: r.clerkId ? 'Clerk' : r.password ? 'old SafeComm password' : r.supabaseUserId ? 'Supabase' : 'office/other',
      state, residency: r.residencyStatus, status: r.status, cases: r._count.cases, created: r.registeredAt.toISOString().slice(0, 10) };
  });
  console.table(rows);
  const residentEmails = new Set(residents.map(r => r.email?.trim().toLowerCase()).filter(Boolean));
  const linkedIds = new Set(residents.map(r => r.supabaseUserId).filter(Boolean));
  const orphans = users.filter(u => !linkedIds.has(u.id) && !residentEmails.has(u.email?.toLowerCase()));
  console.log('Auth users:', users.length, '| residents:', residents.length);
  console.log('Auth users with no resident profile:', orphans.length);
  console.table(orphans.map(u => ({ id: u.id.slice(0, 8), email: mask(u.email ?? null), confirmed: Boolean(u.email_confirmed_at), invited: Boolean(u.invited_at), lastSignIn: u.last_sign_in_at?.slice(0, 10) ?? '-', created: u.created_at.slice(0, 10) })));
  const dupes = [...residents.reduce((m, r) => { const e = r.email?.trim().toLowerCase(); if (e) m.set(e, (m.get(e) ?? 0) + 1); return m; }, new Map<string, number>())].filter(([, n]) => n > 1);
  console.log('Duplicate profile emails (case-insensitive):', dupes.length, dupes.map(([e, n]) => `${mask(e)} x${n}`).join(', '));
  const untrimmed = residents.filter(r => r.email && (r.email !== r.email.trim() || r.email !== r.email.toLowerCase())).length;
  console.log('Profile emails with spaces or capitals stored:', untrimmed);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
