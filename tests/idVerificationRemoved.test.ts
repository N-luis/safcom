/**
 * Resident ID verification is gone: nothing asks for a government ID, nothing
 * waits for an official's approval, and email verification is left alone.
 * Run with:  npm run test:noidverification      No database.
 */
import fs from 'fs';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const read = (f: string) => fs.readFileSync(f, 'utf8');

const profile = read('app/resident/profile/page.tsx');
ok('profile: no Government ID card, upload or verification status', !/Government ID|idDocument|upload\/id|Verification Status|under review|\bPending\b/.test(profile));
const layout = read('app/resident/layout.tsx');
ok('sidebar: says Resident, not an account status', />?\s*Resident\s*\n/.test(layout) && !/residentStatus|Verified Resident/.test(layout));

const admin = read('app/admin/users/page.tsx');
ok('system admin: no approve, reject or pending review', !/'approve'|'reject'|Reject Registration|Pending Review|pendingResidentCount|Verify &amp; Activate|'Pending'|'Rejected'/.test(admin));
ok('system admin: no way to open a submitted ID', !/idDocument|Submitted ID|isImageDoc/.test(admin));
ok('system admin: Verify Email and Delete Account are still there', admin.includes('Verify Email') && admin.includes('Mark Email Verified') && admin.includes('Delete Resident Account')
  && admin.includes("action: 'verify_email'"));

const verify = read('app/api/admin/residents/[id]/verify/route.ts');
ok('server: approving or rejecting an ID no longer exists', !/approve|reject|Rejected|status: newStatus/.test(verify) && verify.includes("z.literal('verify_email')"));
ok('server: marking an email verified still works, admins only', verify.includes('emailVerified: true') && verify.includes("role !== 'system_admin'"));

const register = read('app/api/residents/register/route.ts');
ok('server: a new resident is Active straight away, no ID field', register.includes("status: 'Active'") && !/idDocument|status: 'Pending'/.test(register));
const me = read('app/api/auth/resident-me/route.ts');
ok('server: a resident can no longer submit an ID or be set back to Pending', !/idDocument|'Pending'/.test(me));
ok('server: a resident can still update their contact number and address', me.includes('contactNumber') && me.includes('address'));
ok('server: ID data is no longer sent to any screen', ![
  'app/api/residents/route.ts', 'app/api/residents/[id]/route.ts', 'app/admin/users/page.tsx',
].some(f => read(f).includes('idDocument')));
ok('server: the login routes never depended on the ID status', !/status.*(Pending|Rejected)/.test(read('app/api/auth/resident-login/route.ts')));

ok('the public ID upload endpoint and the verification stats are deleted', !fs.existsSync('app/api/upload/id/route.ts') && !fs.existsSync('app/api/admin/stats/residents/route.ts'));
const proxy = read('proxy.ts');
ok('stored ID images are no longer public', !proxy.includes("'/uploads'") && !proxy.includes('/api/upload/id'));
ok('email verification pages stay public', proxy.includes("'/verify-email'") && proxy.includes("'/api/auth/resend-verification'"));

ok('captain dashboard: no pending verification count', !read('app/dashboard/page.tsx').includes('pending verification') && !read('app/api/kapitan/overview/route.ts').includes('residentPending'));
ok('old sign-up page: no Upload Valid ID box', !read('app/create/page.tsx').includes('Upload Valid ID'));
const sql = read('prisma/sql/013_remove_id_verification.sql');
ok('existing Pending and Rejected residents become Active; Inactive is untouched', sql.includes(`SET "status" = 'Active' WHERE "status" IN ('Pending', 'Rejected')`) && !/DROP|DELETE/i.test(sql.replace(/^--.*$/gm, '')));

ok('the database model no longer has the ID column', !read('prisma/schema.prisma').includes('idDocument'));
const drop = read('prisma/sql/014_drop_resident_id_document.sql').replace(/^--.*$/gm, '').trim();
ok('the drop script removes that one column and nothing else', drop === 'ALTER TABLE "Resident" DROP COLUMN IF EXISTS "idDocument";', drop);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
