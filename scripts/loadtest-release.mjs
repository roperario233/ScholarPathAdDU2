#!/usr/bin/env node
// Operator load test for a large first-wave results release (100+ cases), with
// no real recipient: every test student has SMS and email switched off and no
// phone number, so only in-app notifications are written and no iprogSMS credit
// or Resend message is spent. Optionally ONE student can carry your own email
// and/or mobile number (--notify-email / --notify-phone) so a real message of each
// kind is sent once, to you; the other students stay quiet. It exercises the real path end to end:
// release_scholarship_results() -> per-row status triggers -> dispatch_notification()
// -> notification_outbox -> the minute worker -> notify-application-status.
//
//   node scripts/loadtest-release.mjs seed [--count 120] [--notify-email you@example.com] [--notify-phone 09171234567]
//   node scripts/loadtest-release.mjs release
//   node scripts/loadtest-release.mjs status        (re-run until the verdict settles)
//   node scripts/loadtest-release.mjs cleanup
//
// Everything hangs off one scholarship titled "LOAD TEST Grant-in-Aid (GIA) ...",
// so a real case can never be released by it. Needs, in the operator's shell only:
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY), LOADTEST_EXPECTED_PROJECT_REF.
// Never put the service-role key in .env or a VITE_ variable.

import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { fetchKeysetRows } from '../src/lib/supabasePaging.js';
import { normalizePhilippineMobile } from '../supabase/functions/_shared/sms.js';

export const TEST_SCHOLARSHIP_TITLE = 'LOAD TEST Grant-in-Aid (GIA) - safe to delete';
export const TEST_EMAIL_DOMAIN = 'loadtest.scholarpath.invalid';
export const STATE_FILE = path.resolve('.loadtest-state.json');
export const MAX_TEST_STUDENTS = 500;
// dispatch_notification() sends this many per transaction at once; the rest queue.
export const DIRECT_SEND_CAP = 20;

export const testEmail = (kind, index = 0) => (kind === 'admin'
  ? `loadtest-admin@${TEST_EMAIL_DOMAIN}`
  : `loadtest-student-${String(index).padStart(3, '0')}@${TEST_EMAIL_DOMAIN}`);

// Chosen so the notification layer has nothing external to do for these users.
export const QUIET_PREFERENCES = Object.freeze({ inAppEnabled: true, emailEnabled: false, smsEnabled: false });

// The one student who may receive a real message (see --notify-email/--notify-phone).
const EMAIL_SHAPE = /^[^ @]+@[^ @]+[.][^ @]+$/;
export const buildRecipientPlan = ({ email = '', phone = '' } = {}) => {
  const cleanEmail = String(email || '').trim();
  const cleanPhone = String(phone || '').trim();
  if (cleanEmail && !EMAIL_SHAPE.test(cleanEmail)) throw new Error('--notify-email is not a valid email address.');
  if (cleanEmail.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`)) throw new Error('--notify-email must be a real address you can read.');
  if (cleanPhone && !normalizePhilippineMobile(cleanPhone)) throw new Error('--notify-phone must be a Philippine mobile number such as 09171234567.');
  return {
    email: cleanEmail,
    phone: cleanPhone,
    expectedExternal: { email: cleanEmail ? 1 : 0, sms: cleanPhone ? 1 : 0 },
    preferences: { inAppEnabled: true, emailEnabled: Boolean(cleanEmail), smsEnabled: Boolean(cleanPhone) },
  };
};

export const isQuietProfile = (profile) => Boolean(profile)
  && profile.notification_preferences?.emailEnabled === false
  && profile.notification_preferences?.smsEnabled === false
  && (profile.phone == null || profile.phone === '');

const tally = (rows, keyOf) => rows.reduce((counts, row) => {
  const key = keyOf(row);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

export const summarizeOutbox = (rows) => {
  const ms = (value) => (value ? new Date(value).getTime() : null);
  const sentImmediately = rows.filter((row) => row.dispatched_at && ms(row.dispatched_at) - ms(row.created_at) < 3000 && row.attempts === 1).length;
  const created = rows.map((row) => ms(row.created_at)).filter(Boolean);
  const completed = rows.map((row) => ms(row.completed_at)).filter(Boolean);
  return {
    total: rows.length,
    byStatus: tally(rows, (row) => row.status),
    maxAttempts: rows.reduce((max, row) => Math.max(max, row.attempts || 0), 0),
    sentImmediately,
    drainSeconds: created.length && completed.length ? Math.round((Math.max(...completed) - Math.min(...created)) / 1000) : null,
  };
};

export const summarizeAttempts = (rows) => ({
  total: rows.length,
  byChannelStatus: tally(rows, (row) => `${row.channel}:${row.status}`),
  externalSent: rows.filter((row) => (row.channel === 'email' || row.channel === 'sms') && row.status === 'sent').length,
  emailSent: rows.filter((row) => row.channel === 'email' && row.status === 'sent').length,
  smsSent: rows.filter((row) => row.channel === 'sms' && row.status === 'sent').length,
  failed: rows.filter((row) => row.status === 'failed').length,
});

// The pass/fail rules for a 100+ case release, kept pure so they are testable.
export const evaluateRelease = ({ seeded, released, replay, outbox, attempts, inAppReleasedNotices, expectedExternal = { email: 0, sms: 0 } }) => {
  const sent = outbox.byStatus.sent || 0;
  const checks = [
    { name: 'Every seeded case was released', ok: released === seeded, detail: `${released} of ${seeded}` },
    { name: 'A repeated request returned the same release', ok: Boolean(replay?.replayed) && replay.count === released, detail: replay ? `replayed=${replay.replayed}, ${replay.count} cases` : 'not run' },
    { name: 'One outbox row per released case', ok: outbox.total >= released, detail: `${outbox.total} rows for ${released} cases` },
    { name: 'No more than the direct-send cap went out at once', ok: outbox.sentImmediately <= DIRECT_SEND_CAP, detail: `${outbox.sentImmediately} sent immediately (cap ${DIRECT_SEND_CAP})` },
    { name: 'Every outbox row finished as sent', ok: outbox.total > 0 && sent === outbox.total, detail: JSON.stringify(outbox.byStatus) },
    { name: 'No row needed more than one retry', ok: outbox.maxAttempts <= 2, detail: `max attempts ${outbox.maxAttempts}` },
    { name: 'Every released student got an in-app notice', ok: inAppReleasedNotices === released, detail: `${inAppReleasedNotices} of ${released}` },
    {
      name: 'Only the expected email and SMS were sent',
      ok: attempts.emailSent === expectedExternal.email && attempts.smsSent === expectedExternal.sms,
      detail: `email ${attempts.emailSent}/${expectedExternal.email}, SMS ${attempts.smsSent}/${expectedExternal.sms}`,
    },
    { name: 'No channel attempt failed', ok: attempts.failed === 0, detail: `${attempts.failed} failed` },
  ];
  return { checks, passed: checks.every((check) => check.ok) };
};

// --- operator plumbing --------------------------------------------------------

const requireEnv = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY in this shell.');
  const ref = new URL(url).hostname.split('.')[0];
  if (!process.env.LOADTEST_EXPECTED_PROJECT_REF || process.env.LOADTEST_EXPECTED_PROJECT_REF !== ref) {
    throw new Error('Set LOADTEST_EXPECTED_PROJECT_REF to the exact project ref you intend to test against.');
  }
  return { url, serviceKey, anonKey };
};

const clients = () => {
  const { url, serviceKey, anonKey } = requireEnv();
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  return { service: createClient(url, serviceKey, options), anon: createClient(url, anonKey, options) };
};

const readState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};
const writeState = (state) => writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

const batched = (values, size = 100) => {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
};

const runBounded = async (items, limit, task) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await task(items[index], index);
    }
  }));
};

const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label} failed (${error.code || error.status || 'error'}): ${error.message}`);
  return data;
};

const createUser = async (service, email, fullName) => {
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw new Error(`Creating ${email} failed: ${error.message}`);
  return { id: data.user.id, password };
};

// --- commands -----------------------------------------------------------------

const seed = async (count, notify = {}) => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TEST_STUDENTS) throw new Error(`--count must be 1-${MAX_TEST_STUDENTS}.`);
  const plan = buildRecipientPlan(notify);
  if (await readState()) throw new Error(`${STATE_FILE} already exists. Run cleanup first.`);
  const { service } = clients();

  const existing = must(await service.from('scholarships').select('id').eq('title', TEST_SCHOLARSHIP_TITLE), 'Scholarship lookup');
  if (existing.length) throw new Error('A load-test scholarship already exists. Run cleanup first.');

  const scholarship = must(await service.from('scholarships').insert({
    title: TEST_SCHOLARSHIP_TITLE,
    category: 'Grant-in-Aid',
    origin: 'AdDU internal',
    coverage_type: 'Partial',
    coverage: 'Load test only - not a real scholarship',
    is_active: false,
    is_matchable: false,
    is_external: false,
  }).select('id').single(), 'Scholarship insert');
  const state = {
    scholarshipId: scholarship.id, seededAt: new Date().toISOString(), count, studentIds: [], adminId: null, adminPassword: null,
    realRecipientId: null, expectedExternal: plan.expectedExternal,
  };
  await writeState(state);
  console.log(`Created test scholarship ${scholarship.id}.`);

  // The test admin runs the real release RPC; it exists only for this test.
  const admin = await createUser(service, testEmail('admin'), 'Load Test Admin');
  state.adminId = admin.id;
  state.adminPassword = admin.password;
  await writeState(state);
  must(await service.from('profiles').update({ role: 'admissions_admin', notification_preferences: QUIET_PREFERENCES, phone: null }).eq('user_id', admin.id), 'Admin role');

  const indexes = Array.from({ length: count }, (_, i) => i + 1);
  await runBounded(indexes, 4, async (index) => {
    const user = await createUser(service, testEmail('student', index), `Load Test Student ${String(index).padStart(3, '0')}`);
    state.studentIds.push(user.id);
  });
  await writeState(state);
  console.log(`Created ${state.studentIds.length} test students.`);

  for (const ids of batched(state.studentIds)) {
    must(await service.from('profiles').update({ notification_preferences: QUIET_PREFERENCES, phone: null }).in('user_id', ids), 'Quiet preferences');
  }

  // One student may carry the operator's own email and/or number.
  if (plan.email || plan.phone) {
    state.realRecipientId = state.studentIds[0];
    must(await service.from('profiles').update({
      notification_preferences: plan.preferences,
      email: plan.email || null,
      phone: plan.phone || null,
    }).eq('user_id', state.realRecipientId), 'Real recipient');
    await writeState(state);
    const stored = must(await service.from('profiles').select('email, phone, notification_preferences').eq('user_id', state.realRecipientId).single(), 'Real recipient read-back');
    const prefs = stored.notification_preferences || {};
    if ((plan.email && stored.email !== plan.email) || (plan.phone && !stored.phone)
      || Boolean(prefs.emailEnabled) !== Boolean(plan.email) || Boolean(prefs.smsEnabled) !== Boolean(plan.phone)) {
      throw new Error('Your email/number did not stick on the test profile (it was changed after being saved). Nothing was approved. Run cleanup, then tell the developer.');
    }
    console.log(`One student will receive: ${plan.email ? 'an email' : ''}${plan.email && plan.phone ? ' and ' : ''}${plan.phone ? 'an SMS' : ''}.`);
  }

  // Refuse to go on unless every other recipient is verifiably quiet.
  const profiles = [];
  for (const ids of batched([...state.studentIds, state.adminId])) {
    profiles.push(...must(await service.from('profiles').select('user_id, phone, notification_preferences').in('user_id', ids), 'Profile check'));
  }
  const loud = profiles.filter((profile) => profile.user_id !== state.realRecipientId && !isQuietProfile(profile));
  if (loud.length || profiles.length !== state.studentIds.length + 1) {
    throw new Error(`${loud.length} test profiles are not quiet (or are missing). Nothing was approved. Run cleanup, then investigate.`);
  }
  console.log(`Verified: every test recipient${state.realRecipientId ? ' except the one you chose' : ''} has SMS and email off and no phone number.`);

  const submittedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const applications = state.studentIds.map((studentId) => ({
    id: randomUUID(),
    student_id: studentId,
    scholarship_id: state.scholarshipId,
    status: 'Approved',
    submitted_at: submittedAt,
    statement: 'Load test application.',
    timeline: [{ id: `ev-${randomUUID()}`, stage: 'Approved', note: 'Load test case.', actor: 'System', at: submittedAt.slice(0, 10) }],
  }));
  for (const rows of batched(applications)) must(await service.from('applications').insert(rows), 'Application insert');
  for (const rows of batched(applications.map((application) => ({
    application_id: application.id, coverage_percent: 100, set_by_role: 'admissions_admin', note: 'Load test.',
  })))) {
    must(await service.from('application_grant_amounts').insert(rows), 'Grant amount insert');
  }
  console.log(`Created ${applications.length} Approved cases with a recorded grant amount.`);
  console.log('Next: node scripts/loadtest-release.mjs release');
};

const releaseAll = async () => {
  const state = await readState();
  if (!state) throw new Error('Nothing seeded. Run seed first.');
  const expected = state.expectedExternal || { email: 0, sms: 0 };
  console.log(`Releasing ${state.count} seeded cases. Real messages expected: ${expected.email} email, ${expected.sms} SMS${expected.email || expected.sms ? '' : ' (this data was seeded without --notify-email/--notify-phone)'}.`);
  const { service, anon } = clients();

  if (expected.email || expected.sms) {
    const recipient = must(await service.from('profiles').select('email, phone, notification_preferences').eq('user_id', state.realRecipientId || '00000000-0000-0000-0000-000000000000').maybeSingle(), 'Recipient check');
    const prefs = recipient?.notification_preferences || {};
    if (!recipient || Boolean(prefs.emailEnabled) !== Boolean(expected.email) || Boolean(prefs.smsEnabled) !== Boolean(expected.sms)) {
      throw new Error('The recipient you asked for is not set up on the test data. Nothing was released. Run cleanup, then seed again.');
    }
  }

  const signIn = await anon.auth.signInWithPassword({ email: testEmail('admin'), password: state.adminPassword });
  if (signIn.error) throw new Error(`Test admin sign-in failed: ${signIn.error.message}`);

  const [{ id: baselineOutboxId } = { id: 0 }] = must(await service.from('notification_outbox').select('id').order('id', { ascending: false }).limit(1), 'Outbox baseline');
  const confirmBy = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const requestId = randomUUID();

  const started = Date.now();
  const first = await anon.rpc('release_scholarship_results', { p_scholarship_id: state.scholarshipId, p_confirm_by: confirmBy, p_request_id: requestId });
  if (first.error) throw new Error(`Release failed (${first.error.code}): ${first.error.message}`);
  const elapsedMs = Date.now() - started;
  const released = first.data.releasedApplicationIds.length;
  console.log(`release_scholarship_results() released ${released} cases in ${(elapsedMs / 1000).toFixed(1)} s (one transaction).`);

  const second = await anon.rpc('release_scholarship_results', { p_scholarship_id: state.scholarshipId, p_confirm_by: confirmBy, p_request_id: requestId });
  if (second.error) throw new Error(`Replay failed (${second.error.code}): ${second.error.message}`);
  const replay = { replayed: Boolean(second.data.replayed), count: second.data.releasedApplicationIds.length };
  console.log(`Repeating the same request: replayed=${replay.replayed}, ${replay.count} cases (must not release anything twice).`);

  await writeState({ ...state, releasedAt: new Date().toISOString(), baselineOutboxId, released, replay, releaseElapsedMs: elapsedMs });
  console.log('The worker sends the queued notices once a minute. Run status every minute until it settles.');
};

const fetchAll = async (service, table, columns, orderColumn, apply) => {
  const { data, error } = await fetchKeysetRows(() => apply(service.from(table).select(columns)), { orderColumn, ascending: true });
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return data;
};

const status = async () => {
  const state = await readState();
  if (!state?.releasedAt) throw new Error('Nothing released yet. Run release first.');
  const { service } = clients();

  const applications = must(await service.from('applications').select('id, status').eq('scholarship_id', state.scholarshipId), 'Applications');
  const ids = new Set(applications.map((application) => application.id));
  const outboxRows = (await fetchAll(service, 'notification_outbox', 'id, dedupe_key, status, attempts, created_at, dispatched_at, completed_at, last_http_status', 'id', (query) => query.gt('id', state.baselineOutboxId)))
    .filter((row) => row.dedupe_key.startsWith('application-status-') && [...ids].some((id) => row.dedupe_key.includes(id)));
  const attemptRows = (await fetchAll(service, 'notification_delivery_attempts', 'id, source_key, channel, status, error_code', 'id', (query) => query.gte('attempted_at', state.releasedAt)))
    .filter((row) => [...ids].some((id) => row.source_key.includes(id)));

  let noticeCount = 0;
  for (const profileIds of batched(state.studentIds)) {
    const result = await service.from('notifications').select('id', { count: 'exact', head: true }).in('profile_id', profileIds).like('source_key', 'application-status-%-Released');
    if (result.error) throw new Error(`Notification count failed: ${result.error.message}`);
    noticeCount += result.count || 0;
  }

  const outbox = summarizeOutbox(outboxRows);
  const attempts = summarizeAttempts(attemptRows);
  console.log(`Cases now: ${JSON.stringify(tally(applications, (application) => application.status))}`);
  console.log(`Outbox:    ${JSON.stringify(outbox)}`);
  console.log(`Attempts:  ${JSON.stringify(attempts)}`);
  console.log(`In-app "Released" notices: ${noticeCount}`);

  const verdict = evaluateRelease({
    seeded: state.count, released: state.released, replay: state.replay, outbox, attempts, inAppReleasedNotices: noticeCount, expectedExternal: state.expectedExternal,
  });
  verdict.checks.forEach((check) => console.log(`${check.ok ? 'PASS' : 'WAIT/FAIL'}  ${check.name} - ${check.detail}`));
  if (state.expectedExternal && (state.expectedExternal.email || state.expectedExternal.sms)) {
    console.log('');
    console.log('Now check your inbox / phone for the LOAD TEST release notice. For SMS, "sent" only means the gateway accepted it.');
  }
  console.log(verdict.passed ? '\nRESULT: PASS' : '\nRESULT: not settled or failing - re-run in a minute; if it stays red, read the lines above.');
};

const cleanup = async () => {
  const { service } = clients();
  const state = await readState();
  const schol = must(await service.from('scholarships').select('id').eq('title', TEST_SCHOLARSHIP_TITLE), 'Scholarship lookup');
  const scholarshipIds = schol.map((row) => row.id);

  for (const scholarshipId of scholarshipIds) {
    const apps = must(await service.from('applications').select('id').eq('scholarship_id', scholarshipId), 'Applications');
    for (const ids of batched(apps.map((row) => row.id))) {
      // application_status_log is the one child table that blocks an application delete.
      must(await service.from('application_status_log').delete().in('application_id', ids), 'Status log delete');
    }
    must(await service.from('scholarships').delete().eq('id', scholarshipId), 'Scholarship delete');
    console.log(`Deleted the test scholarship and its ${apps.length} cases (releases, offers and grants cascade).`);
  }

  // profiles.user_id has no foreign key to auth.users, so deleting an account does
  // not delete its profile: remove the test profiles explicitly (recorded ids plus
  // anything named like a test account, in case an earlier run left some behind).
  const recorded = [...(state?.studentIds || []), state?.adminId].filter(Boolean);
  let profilesRemoved = 0;
  for (const ids of batched(recorded)) {
    const { data } = await service.from('profiles').delete().in('user_id', ids).select('user_id');
    profilesRemoved += data?.length || 0;
  }
  for (const [column, pattern] of [['email', `%@${TEST_EMAIL_DOMAIN}`], ['full_name', 'Load Test Student %'], ['full_name', 'Load Test Admin']]) {
    const { data, error } = await service.from('profiles').delete().like(column, pattern).select('user_id');
    if (error) throw new Error(`Profile cleanup failed: ${error.message}`);
    profilesRemoved += data?.length || 0;
  }
  console.log(`Deleted ${profilesRemoved} test profiles.`);

  // Users: the ones recorded in the state file, plus any stray test-domain account.
  const toDelete = new Set([...(state?.studentIds || []), state?.adminId].filter(Boolean));
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`User listing failed: ${error.message}`);
    data.users.filter((user) => user.email?.endsWith(`@${TEST_EMAIL_DOMAIN}`)).forEach((user) => toDelete.add(user.id));
    if (data.users.length < 200) break;
  }
  await runBounded([...toDelete], 4, async (id) => {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) throw new Error(`Deleting a test user failed: ${error.message}`);
  });
  console.log(`Deleted ${toDelete.size} test accounts.`);
  await rm(STATE_FILE, { force: true });
  console.log('Done. Outbox rows are pruned by the worker after 14 days; delivery-attempt rows are append-only and hold no personal data.');
};

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { count: { type: 'string', default: '120' }, 'notify-email': { type: 'string' }, 'notify-phone': { type: 'string' } },
  });
  const command = positionals[0];
  if (positionals.length > 1) {
    // npm on Windows PowerShell can swallow the flag names and pass only their
    // values, so a recipient would silently be dropped. Refuse instead.
    throw new Error(`Unexpected extra arguments (${positionals.slice(1).join(' ')}). The flags were probably stripped by npm: run the script with node directly, e.g. node scripts/loadtest-release.mjs seed --count 120 --notify-email you@gmail.com --notify-phone 09171234567`);
  }
  if (command === 'seed') {
    return seed(Number(values.count), {
      email: values['notify-email'] ?? process.env.LOADTEST_NOTIFY_EMAIL,
      phone: values['notify-phone'] ?? process.env.LOADTEST_NOTIFY_PHONE,
    });
  }
  if (command === 'release') return releaseAll();
  if (command === 'status') return status();
  if (command === 'cleanup') return cleanup();
  console.log('Usage: node scripts/loadtest-release.mjs seed [--count 120] | release | status | cleanup');
  return undefined;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message || 'Load test failed');
    process.exitCode = 1;
  });
}
