/**
 * People Involved - from the resident's report to both intake forms, through
 * the real routes and the real database (in-process).
 * Run with:  npm run test:peopleinvolved
 *
 * Fictional people only, marked PROBE-PI and removed at the end. Runs with the
 * report's rules alone (no AI key needed).
 */
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as intakeGET, POST as intakePOST } from '../app/api/cases/[id]/official-intake/route';
import { PUT as recordsPUT } from '../app/api/cases/[id]/records/route';
import { VAWC_TYPES } from '../lib/vawcTypes';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-PI';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const VAWC_TEXT = 'Sinasaktan po ng asawa niya ang kapitbahay naming babae. Kagabi sinampal at sinuntok siya, narinig namin ang sigaw niya at may pasa siya ngayon.';
const BLOTTER_TEXT = 'Ang kapitbahay po namin ay nagpapatugtog ng videoke hanggang alas-dos ng madaling araw gabi-gabi. Hindi kami makatulog.';

async function main() {
  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  delete process.env.GROQ_API_KEY;
  try {
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.pi.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: '!unusable', role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mkUser('vawc', 'vawc_officer');
    const V2 = await mkUser('vawc2', 'vawc_officer');
    const B = await mkUser('blotter', 'officer');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Reporter', age: 33, gender: 'Female',
      barangay: 'Ayukit', address: 'fictional address', emailVerified: true } });
    residents.push(R.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    const file = async (body: Body) => {
      const out = await json(await filePOST(req('/api/resident/cases', resCookie, 'POST', { intakeAnswers: [], barangay: 'Ayukit', ...body })));
      if (out.body?.data?.id) caseIds.push(out.body.data.id);
      return out;
    };
    const P = (id: string) => ({ params: Promise.resolve({ id }) });
    const intake = (id: string, cookie: string) => intakeGET(req(`/api/cases/${id}/official-intake`, cookie), P(id)).then(json);

    console.log('\nThe resident files reports');
    const v = await file({ description: VAWC_TEXT, intakeNarrative: VAWC_TEXT, reportingRelationship: 'THIRD_PARTY', affectedPersonNote: 'kapitbahay naming babae',
      affectedParty: { fullName: 'Maria Fictional', age: 29, address: '12 Probe Street', contactNumber: '+639171234567', relationship: 'Kapitbahay', dependentsAffected: 'yes', details: 'May dalawang anak' },
      reportedParty: { fullName: 'Pedro Fictional', age: 35, address: '12 Probe Street', relationship: 'Asawa niya', details: 'Umiinom gabi-gabi' } });
    ok('a report with both people is filed', v.status === 201, `${v.status} ${v.body.error ?? ''}`);
    const vCase = await prisma.case.findUnique({ where: { id: v.body.data.id }, include: { parties: true } });
    const aff = vCase?.parties.find(p => p.role === 'AFFECTED'); const rep = vCase?.parties.find(p => p.role === 'REPORTED');
    ok('the person affected is saved on this case, every field, as the resident gave it', aff?.caseId === vCase?.id && aff?.source === 'reporter'
      && aff.fullName === 'Maria Fictional' && aff.age === 29 && aff.address === '12 Probe Street' && aff.contactNumber === '+639171234567'
      && aff.relationship === 'Kapitbahay' && aff.dependentsAffected === 'yes' && aff.details === 'May dalawang anak');
    ok('the person reported is saved separately, every field', rep?.caseId === vCase?.id && rep?.source === 'reporter' && rep.fullName === 'Pedro Fictional'
      && rep.age === 35 && rep.relationship === 'Asawa niya' && rep.details === 'Umiinom gabi-gabi' && rep.contactNumber === null);
    ok('it went to the VAWC desk', (VAWC_TYPES as readonly string[]).includes(vCase?.caseType ?? ''), vCase?.caseType);

    const b = await file({ description: BLOTTER_TEXT, intakeNarrative: BLOTTER_TEXT, reportingRelationship: 'SELF',
      affectedParty: { dependentsAffected: 'no' }, reportedParty: { fullName: 'Kanor Fictional', relationship: 'Kapitbahay' } });
    ok('a self-report with only the person reported (and the dependents answer) is filed', b.status === 201, `${b.status} ${b.body.error ?? ''}`);
    const bCase = await prisma.case.findUnique({ where: { id: b.body.data.id }, include: { parties: true } });
    ok('optional fields stay empty (null) - nothing is made up', bCase?.parties.find(p => p.role === 'REPORTED')?.age === null
      && bCase?.parties.find(p => p.role === 'REPORTED')?.address === null && bCase?.parties.find(p => p.role === 'AFFECTED')?.fullName === null);

    const none = await file({ description: BLOTTER_TEXT, intakeNarrative: BLOTTER_TEXT, reportingRelationship: 'SELF' });
    ok('a report with no people at all is still filed, and saves no person', none.status === 201
      && (await prisma.caseParty.count({ where: { caseId: none.body.data?.id } })) === 0, `${none.status} ${none.body.error ?? ''}`);
    const badPhone = await file({ description: VAWC_TEXT, intakeNarrative: VAWC_TEXT, reportingRelationship: 'THIRD_PARTY', affectedParty: { contactNumber: '0917' } });
    ok('a contact number that is not a +63 mobile number is refused, never stored half-done', badPhone.status === 400, `${badPhone.status}`);

    // The desk takes the cases (assignment is what opens the intake).
    await prisma.case.update({ where: { id: vCase!.id }, data: { assignedToId: V.id } });
    await prisma.case.update({ where: { id: bCase!.id }, data: { assignedToId: B.id } });

    console.log('\nThe VAWC intake form');
    const vi = await intake(vCase!.id, V.cookie);
    const people = vi.body.data?.context?.people;
    ok('the assigned VAWC officer opens it (200) with People involved', vi.status === 200 && Boolean(people), `${vi.status}`);
    ok('person affected: the resident\'s record, every field, marked as from the report', people?.affected.length === 1 && people.affected[0].source === 'reporter'
      && people.affected[0].fullName === 'Maria Fictional' && people.affected[0].contactNumber === '+639171234567' && people.affected[0].dependentsAffected === 'yes');
    ok('person reported: separate, from the report, no contact number field', people?.reported.length === 1 && people.reported[0].fullName === 'Pedro Fictional'
      && people.reported[0].contactNumber === null);
    ok('the reporter is not taken for the person affected; the reporter\'s note is kept', people?.reporterIsAffected === false && people.affectedNote === 'kapitbahay naming babae');

    console.log('\nThe Blotter intake form');
    const bi = await intake(bCase!.id, B.cookie);
    const bp = bi.body.data?.context?.people;
    ok('the assigned blotter officer opens it with People involved', bi.status === 200 && Boolean(bp));
    ok('a self-report: the reporter is the person affected; the dependents answer is kept', bp?.reporterIsAffected === true && bp.affected[0]?.dependentsAffected === 'no');
    ok('the person reported is shown', bp?.reported[0]?.fullName === 'Kanor Fictional' && bp.reported[0].relationship === 'Kapitbahay');
    const bStart = await json(await intakePOST(req(`/api/cases/${bCase!.id}/official-intake`, B.cookie, 'POST', {}), P(bCase!.id)));
    ok('starting the Blotter intake still fills the respondent from the person reported (never the person affected)', bStart.status < 300
      && JSON.stringify(bStart.body.data?.intake?.responses?.respondentName?.value) === JSON.stringify({ full: 'Kanor Fictional' }), JSON.stringify(bStart.body).slice(0, 300));

    console.log('\nWho may see it');
    ok('a blotter officer: the VAWC case does not exist (404)', (await intake(vCase!.id, B.cookie)).status === 404);
    const other = await intake(vCase!.id, V2.cookie);
    ok('another VAWC officer, not assigned: refused, no people sent', other.status === 403 && !JSON.stringify(other.body).includes('Maria Fictional'));
    ok('a resident session: refused', (await intake(vCase!.id, resCookie)).status === 401);

    console.log('\nAn official supplements; the original stays');
    const put = await json(await recordsPUT(req(`/api/cases/${vCase!.id}/records`, V.cookie, 'PUT', { role: 'REPORTED', party: { fullName: 'Pedro Fictional Santos', age: 36 } }), P(vCase!.id)));
    ok('the official records corrected details', put.status === 200, `${put.status} ${put.body.error ?? ''}`);
    const after = await prisma.caseParty.findMany({ where: { caseId: vCase!.id, role: 'REPORTED' } });
    ok('the resident\'s record is untouched; the official\'s is a separate record', after.length === 2
      && after.find(p => p.source === 'reporter')?.fullName === 'Pedro Fictional' && after.find(p => p.source === 'reporter')?.age === 35
      && after.find(p => p.source === 'official')?.fullName === 'Pedro Fictional Santos');
    const vi2 = (await intake(vCase!.id, V.cookie)).body.data.context.people;
    ok('the intake shows both, resident first, each marked by who gave it', vi2.reported.map((r: Body) => `${r.source}:${r.fullName}`).join('|') === 'reporter:Pedro Fictional|official:Pedro Fictional Santos');
    const vStart = await json(await intakePOST(req(`/api/cases/${vCase!.id}/official-intake`, V.cookie, 'POST', {}), P(vCase!.id)));
    const resp = vStart.body.data?.intake?.responses ?? {};
    const pre = vStart.body.data?.intake?.prefilled ?? {};
    ok('starting the VAWC intake fills the ages that fit exactly (official record first), marked with their source', vStart.status < 300
      && resp.perpAge?.value === '36' && pre.perpAge === 'official record on the case' && resp.age?.value === '29' && pre.age === 'the report', JSON.stringify({ resp: { a: resp.age, p: resp.perpAge }, pre }));
    ok('names are not split or guessed', resp.victimName === undefined && resp.perpName === undefined);

    console.log('\nEarlier reports');
    const legacy = await prisma.case.create({ data: { caseNumber: `${TAG}-L-${process.pid}`, residentName: 'Probe Reporter', caseType: 'Noise Complaint', barangay: 'x',
      description: 'An older report.', status: 'Open', residentId: R.id, assignedToId: B.id } });
    caseIds.push(legacy.id);
    await prisma.caseParty.create({ data: { caseId: legacy.id, role: 'REPORTED', fullName: 'Older Fictional', source: 'reporter' } });
    const li = (await intake(legacy.id, B.cookie)).body.data?.context?.people;
    ok('a report filed before this change shows what it saved, and "Not provided" for the rest', li?.reported[0]?.fullName === 'Older Fictional' && li.reported[0].age === null
      && li.affected.length === 0);
  } finally {
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { OR: [{ id: { in: caseIds } }, { residentId: { in: residents } }] } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.caseParty.count({ where: { caseId: { in: caseIds } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.pi.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
