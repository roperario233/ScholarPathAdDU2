#!/usr/bin/env node
// Operator test of the application import at volume (default 1,500 cases), using
// synthetic data that is clearly labelled and fully removable.
//
//   node scripts/loadtest-import.mjs prepare [--count 1500]
//        creates a throwaway General Pool scholarship, N quiet test students and an
//        import manifest (plus two tiny placeholder PDFs) under ./loadtest-import/
//   node scripts/import-applications.mjs --manifest loadtest-import/manifest.json
//        (the real importer: dry run first, then --apply; prepare prints the exact lines)
//   node scripts/loadtest-import.mjs verify
//        reconciles what the import wrote against what it should have written
//   node scripts/loadtest-import.mjs cleanup
//        removes the stored files, cases, scholarship, profiles and accounts
//
// Every student has SMS and email off and no phone number, the import itself sends
// nothing, and verify fails if any notification appeared. Needs, in this shell only:
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//   LOADTEST_EXPECTED_PROJECT_REF.
// Never put the service-role key in .env or a VITE_ variable.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { fetchKeysetRows } from '../src/lib/supabasePaging.js';
import {
  IMPORT_EMAIL_DOMAIN,
  IMPORT_NAME_PREFIX,
  IMPORT_SCHOLARSHIP_ROW,
  IMPORT_TEST_TITLE,
  buildPlaceholderPdf,
  buildRecord,
  buildStudent,
  evaluateImport,
  importStudentEmail,
  importStudentName,
} from './lib/importFixture.mjs';

export const STATE_FILE = path.resolve('.loadtest-import-state.json');
export const WORK_DIR = path.resolve('loadtest-import');
export const MAX_COUNT = 3000;
const QUIET_PREFERENCES = { inAppEnabled: true, emailEnabled: false, smsEnabled: false };
const DOCUMENT_BUCKET = 'documents';

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

const getService = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell.');
  const ref = new URL(url).hostname.split('.')[0];
  if (!process.env.LOADTEST_EXPECTED_PROJECT_REF || process.env.LOADTEST_EXPECTED_PROJECT_REF !== ref) {
    throw new Error('Set LOADTEST_EXPECTED_PROJECT_REF to the exact project ref you intend to test against.');
  }
  return { service: createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }), url, ref };
};

const readState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};
const writeState = (state) => writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

// Counts rows whose `column` is in `ids`, in bounded batches (head requests only).
const countIn = async (service, table, column, ids, refine = (query) => query) => {
  let total = 0;
  for (const batch of batched(ids)) {
    const result = await refine(service.from(table).select('*', { count: 'exact', head: true }).in(column, batch));
    if (result.error) throw new Error(`${table} count failed: ${result.error.message}`);
    total += result.count || 0;
  }
  return total;
};

// --- prepare --------------------------------------------------------------------

const prepare = async (count) => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`--count must be 1-${MAX_COUNT}.`);
  if (await readState()) throw new Error(`${STATE_FILE} already exists. Run cleanup first.`);
  const { service, ref } = getService();

  const existing = must(await service.from('scholarships').select('id').eq('title', IMPORT_TEST_TITLE), 'Scholarship lookup');
  if (existing.length) throw new Error('An import-test scholarship already exists. Run cleanup first.');

  const scholarship = must(await service.from('scholarships').insert(IMPORT_SCHOLARSHIP_ROW).select('id').single(), 'Scholarship insert');
  const state = { createdAt: new Date().toISOString(), ref, count, scholarshipId: scholarship.id, batchId: randomUUID(), students: [] };
  await writeState(state);
  const stored = must(await service.from('scholarships').select('maximum_income, minimum_qpi, rule_family, is_matchable, is_external').eq('id', scholarship.id).single(), 'Scholarship read-back');
  if (Number(stored.maximum_income) !== IMPORT_SCHOLARSHIP_ROW.maximum_income || Number(stored.minimum_qpi) !== IMPORT_SCHOLARSHIP_ROW.minimum_qpi
    || stored.rule_family !== 'general-pool' || !stored.is_matchable || stored.is_external) {
    throw new Error('The test scholarship was not stored with the expected limits. Nothing was created for it. Run cleanup, then investigate.');
  }
  console.log(`Created test scholarship ${scholarship.id}.`);

  const indexes = Array.from({ length: count }, (_, i) => i + 1);
  let created = 0;
  await runBounded(indexes, 5, async (index) => {
    // A rate limit or a server hiccup is retried with a growing pause; anything
    // else (a duplicate, a bad request) stops the run.
    let result;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      result = await service.auth.admin.createUser({
        email: importStudentEmail(index),
        password: randomUUID() + randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: importStudentName(index) },
      });
      const status = result.error?.status;
      if (!result.error || !(status === 429 || status >= 500)) break;
      await new Promise((resolve) => { setTimeout(resolve, 1000 * 2 ** attempt); });
    }
    if (result.error) throw new Error(`Creating account ${index} failed: ${result.error.message}`);
    state.students.push({ index, id: result.data.user.id });
    created += 1;
    if (created % 100 === 0) {
      console.log(`  accounts: ${created}/${count}`);
      await writeState(state);
    }
  });
  state.students.sort((a, b) => a.index - b.index);
  await writeState(state);
  console.log(`Created ${state.students.length} test accounts.`);

  // Profile rows, quiet and filled with the same values the snapshots carry.
  for (const batch of batched(state.students)) {
    const rows = batch.map(({ index, id }) => {
      const { profile } = buildStudent(index);
      return {
        user_id: id,
        role: 'student',
        full_name: profile.fullName,
        email: profile.email,
        phone: null,
        student_number: profile.studentNumber,
        degree_program: profile.degreeProgram,
        department: profile.department,
        qpi: profile.qpi,
        household_income: profile.householdIncome,
        notification_preferences: QUIET_PREFERENCES,
      };
    });
    must(await service.from('profiles').upsert(rows, { onConflict: 'user_id' }), 'Profile upsert');
  }
  let loud = 0;
  for (const batch of batched(state.students.map((student) => student.id))) {
    const rows = must(await service.from('profiles').select('role, phone, notification_preferences').in('user_id', batch), 'Profile check');
    loud += rows.filter((row) => row.role !== 'student' || row.phone || row.notification_preferences?.emailEnabled !== false || row.notification_preferences?.smsEnabled !== false).length;
  }
  if (loud) throw new Error(`${loud} test profiles are not quiet students. Nothing was imported. Run cleanup, then investigate.`);
  console.log('Verified: every test student has SMS and email off, no phone number, and the student role.');

  const now = new Date();
  const records = state.students.map(({ index, id }) => buildRecord({
    index,
    studentId: id,
    scholarshipId: scholarship.id,
    applicationId: randomUUID(),
    gradeReportId: randomUUID(),
    incomeProofId: randomUUID(),
    now,
  }));
  await mkdir(path.join(WORK_DIR, 'files'), { recursive: true });
  await writeFile(path.join(WORK_DIR, 'files', 'grade-report.pdf'), buildPlaceholderPdf('Grade report'));
  await writeFile(path.join(WORK_DIR, 'files', 'income-proof.pdf'), buildPlaceholderPdf('Income proof'));
  await writeFile(path.join(WORK_DIR, 'manifest.json'), `${JSON.stringify({ version: 1, batchId: state.batchId, records })}\n`);
  await writeState(state);

  console.log(`Wrote ${records.length} cases (${records.length * 2} documents) to ${path.join('loadtest-import', 'manifest.json')}.`);
  console.log('');
  console.log('Next, with the same shell variables plus:');
  console.log(`  $env:APPLICATION_IMPORT_EXPECTED_PROJECT_REF="${ref}"`);
  console.log('  node scripts/import-applications.mjs --manifest loadtest-import/manifest.json');
  console.log('If the dry run passes:');
  console.log(`  $env:APPLICATION_IMPORT_APPROVED_BATCH="${state.batchId}"`);
  console.log('  node scripts/import-applications.mjs --manifest loadtest-import/manifest.json --apply');
  console.log('Then: node scripts/loadtest-import.mjs verify');
};

// --- verify ---------------------------------------------------------------------

const fetchAll = async (service, table, columns, orderColumn, apply) => {
  const { data, error } = await fetchKeysetRows(() => apply(service.from(table).select(columns)), { orderColumn, ascending: true });
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return data;
};

const verify = async () => {
  const state = await readState();
  if (!state) throw new Error('Nothing prepared. Run prepare first.');
  const { service } = getService();

  const apps = await fetchAll(service, 'applications', 'id, status', 'id', (query) => query.eq('scholarship_id', state.scholarshipId));
  const appIds = apps.map((application) => application.id);
  const studentIds = state.students.map((student) => student.id);
  if (!appIds.length) throw new Error('No imported cases found for the test scholarship. Did the --apply run finish?');

  const batch = must(await service.from('application_import_batches').select('status, failed_rows, imported_rows').eq('id', state.batchId).maybeSingle(), 'Import batch');
  const importRecords = await countIn(service, 'application_import_records', 'application_id', appIds);
  const links = await countIn(service, 'application_documents', 'application_id', appIds);
  const pendingDocuments = await countIn(service, 'documents', 'owner_id', studentIds, (query) => query.eq('verification_status', 'Pending'));
  const decidedDocuments = await countIn(service, 'documents', 'owner_id', studentIds, (query) => query.not('verification_decided_at', 'is', null));
  const financialSnapshots = await countIn(service, 'application_financial_details', 'application_id', appIds, (query) => query.not('financial_snapshot', 'is', null));
  const submittedLogRows = await countIn(service, 'application_status_log', 'application_id', appIds, (query) => query.eq('to_status', 'Submitted'));
  const systemLogRows = await countIn(service, 'application_status_log', 'application_id', appIds, (query) => query.eq('to_status', 'Submitted').eq('actor_role', 'system').is('actor_id', null));
  const notifications = await countIn(service, 'notifications', 'profile_id', studentIds);

  const appIdSet = new Set(appIds);
  const outbox = (await fetchAll(service, 'notification_outbox', 'id, dedupe_key', 'id', (query) => query.gte('created_at', state.createdAt)))
    .filter((row) => [...appIdSet].some((id) => row.dedupe_key.includes(id)));

  // A sample of the stored files: the import function already refuses a missing
  // object, so this is an independent spot check.
  const sampleIds = studentIds.filter((_, i) => i % Math.max(1, Math.floor(studentIds.length / 40)) === 0).slice(0, 40);
  const docs = must(await service.from('documents').select('owner_id, id, storage_path').in('owner_id', sampleIds), 'Document sample');
  let missing = 0;
  await runBounded(docs, 6, async (doc) => {
    const folder = doc.storage_path.split('/').slice(0, -1).join('/');
    const file = doc.storage_path.split('/').pop();
    const { data, error } = await service.storage.from(DOCUMENT_BUCKET).list(folder, { limit: 5 });
    if (error || !(data || []).some((entry) => entry.name === file)) missing += 1;
  });

  const counts = {
    submitted: apps.filter((application) => application.status === 'Submitted').length,
    importRecords,
    batchStatus: batch?.status || 'missing',
    batchFailed: batch?.failed_rows ?? -1,
    links,
    pendingDocuments,
    decidedDocuments,
    financialSnapshots,
    submittedLogRows,
    systemLogRows,
    notifications,
    outboxRows: outbox.length,
    sampledFilesChecked: docs.length,
    sampledFilesMissing: missing,
  };
  console.log(`Counts: ${JSON.stringify(counts)}`);
  const verdict = evaluateImport({ expected: state.count, counts });
  verdict.checks.forEach((check) => console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name} - ${check.detail}`));
  console.log(verdict.passed ? '\nRESULT: PASS' : '\nRESULT: FAIL - read the lines marked FAIL above.');
};

// --- cleanup --------------------------------------------------------------------

const cleanup = async () => {
  const { service } = getService();
  const state = await readState();
  const studentIds = (state?.students || []).map((student) => student.id);

  // Stored files first: their paths come from the document rows about to be deleted.
  const paths = [];
  for (const batch of batched(studentIds)) {
    const rows = must(await service.from('documents').select('storage_path').in('owner_id', batch), 'Document paths');
    rows.forEach((row) => row.storage_path && paths.push(row.storage_path));
  }
  for (const batch of batched(paths)) {
    const { error } = await service.storage.from(DOCUMENT_BUCKET).remove(batch);
    if (error) throw new Error(`Storage removal failed: ${error.message}`);
  }
  console.log(`Removed ${paths.length} stored files.`);

  // The importer uploads before the database accepts a case, so a rejected case
  // leaves files that no document row names. Sweep each test student's folder
  // (<student>/<document>/<file>) for anything left.
  let swept = 0;
  await runBounded(studentIds, 6, async (studentId) => {
    const { data: folders } = await service.storage.from(DOCUMENT_BUCKET).list(studentId, { limit: 100 });
    for (const folder of folders || []) {
      const { data: files } = await service.storage.from(DOCUMENT_BUCKET).list(`${studentId}/${folder.name}`, { limit: 100 });
      const leftovers = (files || []).filter((file) => file.name).map((file) => `${studentId}/${folder.name}/${file.name}`);
      if (leftovers.length) {
        const { error } = await service.storage.from(DOCUMENT_BUCKET).remove(leftovers);
        if (error) throw new Error(`Storage sweep failed: ${error.message}`);
        swept += leftovers.length;
      }
    }
  });
  console.log(`Swept ${swept} leftover files from rejected cases.`);

  const scholarships = must(await service.from('scholarships').select('id').eq('title', IMPORT_TEST_TITLE), 'Scholarship lookup');
  for (const { id } of scholarships) {
    const apps = await fetchAll(service, 'applications', 'id', 'id', (query) => query.eq('scholarship_id', id));
    for (const batch of batched(apps.map((application) => application.id))) {
      // application_status_log is the one child table that blocks an application delete.
      must(await service.from('application_status_log').delete().in('application_id', batch), 'Status log delete');
    }
    must(await service.from('scholarships').delete().eq('id', id), 'Scholarship delete');
    console.log(`Deleted the test scholarship and its ${apps.length} cases.`);
  }

  if (state?.batchId) {
    const { error } = await service.from('application_import_batches').delete().eq('id', state.batchId);
    if (error) console.log(`Note: the import ledger row could not be removed (${error.message}); it holds no personal data.`);
  }

  let profilesRemoved = 0;
  for (const batch of batched(studentIds)) {
    const { data } = await service.from('profiles').delete().in('user_id', batch).select('user_id');
    profilesRemoved += data?.length || 0;
  }
  for (const [column, pattern] of [['email', `%@${IMPORT_EMAIL_DOMAIN}`], ['full_name', `${IMPORT_NAME_PREFIX} %`]]) {
    const { data, error } = await service.from('profiles').delete().like(column, pattern).select('user_id');
    if (error) throw new Error(`Profile cleanup failed: ${error.message}`);
    profilesRemoved += data?.length || 0;
  }
  console.log(`Deleted ${profilesRemoved} test profiles.`);

  const accounts = new Set(studentIds);
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`User listing failed: ${error.message}`);
    data.users.filter((user) => user.email?.endsWith(`@${IMPORT_EMAIL_DOMAIN}`)).forEach((user) => accounts.add(user.id));
    if (data.users.length < 200) break;
  }
  await runBounded([...accounts], 5, async (id) => {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) throw new Error(`Deleting a test account failed: ${error.message}`);
  });
  console.log(`Deleted ${accounts.size} test accounts.`);

  await rm(STATE_FILE, { force: true });
  await rm(WORK_DIR, { recursive: true, force: true });
  console.log('Done.');
};

const main = async () => {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { count: { type: 'string', default: '1500' } } });
  if (positionals.length > 1) {
    throw new Error(`Unexpected extra arguments (${positionals.slice(1).join(' ')}). Run the script with node directly, e.g. node scripts/loadtest-import.mjs prepare --count 1500`);
  }
  const command = positionals[0];
  if (command === 'prepare') return prepare(Number(values.count));
  if (command === 'verify') return verify();
  if (command === 'cleanup') return cleanup();
  console.log('Usage: node scripts/loadtest-import.mjs prepare [--count 1500] | verify | cleanup');
  return undefined;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message || 'Import load test failed');
    process.exitCode = 1;
  });
}
