// Supabase Edge Function: notify-application-status
//
// Notifies a student (in-app, email and SMS) when their application status changes.
// The application workspace calls this after writing the new status, and a
// database trigger calls it too (20261014000003), so the notification is sent
// even when the tab closes between the status write and the browser call. The
// authoritative content (recipient, status, scholarship) is re-read here so the
// request body cannot spoof who receives the message.
//
// Deployed with verify_jwt disabled, like process-deadline-reminders, because
// the database caller presents the shared REMINDER_CRON_SECRET rather than a
// JWT (the platform-level JWT check rejects service role keys). Authorization is
// enforced here instead: the caller must present the cron secret, or be an
// Admissions Office Staff or Admin account, the Department Chair responsible for
// the student's department, or the student who owns the application (which
// covers a self-service submission). A repeated call is idempotent via the
// source key.
//
// Results are held (Consultation 2, #8 and #13): an Approved, Waitlisted, or
// Rejected status sends the student nothing. The Admissions Office Admin
// releases a scholarship's results in two waves. The first
// (results_releases.kind = 'offers') releases the accepted applicants, who hear
// through the normal Released notice with the date to confirm by, and the
// waitlisted applicants, who get the waitlist letter from the
// `results-release` mode below. The second (kind = 'closing', once every offer
// is answered) sends every covered Not accepted applicant the general letter
// with the number of applicants and the number accepted. The results_releases
// insert trigger is that mode's primary caller, the Admin's browser the retry.
//
// A record is written to notification_email_log keyed by
// `application-status-<applicationId>-<status>` so a repeated save never
// re-sends the same transition on either channel. The email and SMS channels
// The email, SMS and in-app channels follow the student's notification preferences.
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional), IPROGSMS_API_TOKEN,
// IPROGSMS_PROVIDER (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getStudentApplicationStatusLabel } from '../_shared/applicationStatus.js';
import { describeApplicationStatusUpdate, describeNonAcceptanceLetter, describeWaitlistLetter, isEmailEnabledForUser, isInAppEnabledForUser, renderApplicationStatusEmail, resolveSiteUrl } from '../_shared/email.js';
import { buildDeliveryAttempts, channelAttempt, inAppAttempt, recordDeliveryAttempts } from '../_shared/deliveryAttempts.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';
import { formatPhilippineMobile, getSmsConfig, isSmsEnabledForUser, normalizePhilippineMobile, renderApplicationStatusSms, renderNonAcceptanceLetterSms, renderWaitlistLetterSms, sendSms } from '../_shared/sms.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The statuses whose notice waits for the batch release.
const HELD_STATUSES = ['Approved', 'Waitlisted', 'Rejected'];

// The scoped reviewers (Consultation 2): an interviewer and the Chairperson,
// Assistant Dean, or Dean of the applicant's school. Their scope is decided by
// public.reviewer_scopes_to_student() evaluated as the caller.
const SCOPED_REVIEWER_ROLES = ['dean', 'assistant_dean', 'department_chair', 'interviewer'];
const callerScopesToStudent = async (token, studentId) => {
  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await callerClient.rpc('reviewer_scopes_to_student', { p_student_id: studentId });
  return !error && data === true;
};

const DELIVERY_PAGE_SIZE = 500;
const DELIVERY_IN_BATCH_SIZE = 100;
const DELIVERY_CONCURRENCY = 4;

const chunksOf = (values, size = DELIVERY_IN_BATCH_SIZE) => {
  const chunks = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
};

const fetchAllPages = async (createQuery, pageSize = DELIVERY_PAGE_SIZE) => {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await createQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return { data: rows, error: null };
  }
};

const fetchByIdBatches = async (ids, createQuery) => {
  const batches = chunksOf([...new Set(ids.filter(Boolean))]);
  const rows = [];
  for (let offset = 0; offset < batches.length; offset += DELIVERY_CONCURRENCY) {
    const results = await Promise.all(batches.slice(offset, offset + DELIVERY_CONCURRENCY).map((batch) => (
      fetchAllPages(() => createQuery(batch))
    )));
    const failed = results.find((result) => result.error);
    if (failed) return { data: null, error: failed.error };
    results.forEach((result) => rows.push(...result.data));
  }
  return { data: rows, error: null };
};

const runBounded = async (items, concurrency, task, onError = () => {}) => {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await task(items[index], index);
      } catch (error) {
        onError(error, index);
      }
    }
  });
  await Promise.all(workers);
};

// One letter per covered applicant, deduped on
// `results-release-<releaseId>-<applicationId>` for every channel. An offers
// release writes to the waitlisted applicants; a closing (or legacy) release
// sends the general non-acceptance letter.
const sendResultsReleaseLetters = async ({ supabaseAdmin, releaseId, isTrustedDatabaseCaller, env }) => {
  const { data: release, error: releaseError } = await supabaseAdmin
    .from('results_releases')
    .select('id, scholarship_id, kind, applicant_count, accepted_count')
    .eq('id', releaseId)
    .maybeSingle();
  if (releaseError) return json({ error: 'Unable to load the results release' }, 500);
  if (!release) return json({ error: 'Results release not found' }, 404);

  const [{ data: coverage, error: coverageError }, { data: scholarship, error: scholarshipError }] = await Promise.all([
    fetchAllPages(() => supabaseAdmin
      .from('results_release_applications')
      .select('application_id')
      .eq('release_id', release.id)
      .order('application_id', { ascending: true })),
    supabaseAdmin.from('scholarships').select('title').eq('id', release.scholarship_id).maybeSingle(),
  ]);
  if (coverageError || scholarshipError) return json({ error: 'Unable to load the release coverage' }, 500);
  const ids = (coverage || []).map((row) => row.application_id);
  if (!ids.length) return json({ ok: true, sent: 0, letters: 0 });
  const isOffers = release.kind === 'offers';
  const letterStatus = isOffers ? 'Waitlisted' : 'Rejected';
  const { data: applicants, error: applicantsError } = await fetchByIdBatches(ids, (batch) => supabaseAdmin
    .from('applications')
    .select('id, student_id')
    .in('id', batch)
    .eq('status', letterStatus)
    .order('id', { ascending: true }));
  if (applicantsError) return json({ error: 'Unable to load applicants for the results release' }, 500);
  const rejected = applicants || [];
  if (!rejected.length) return json({ ok: true, sent: 0, letters: 0 });

  const studentIds = [...new Set(rejected.map((application) => application.student_id))];
  const sourceKeys = rejected.map((application) => `results-release-${release.id}-${application.id}`);
  const [{ data: profiles, error: profilesError }, { data: deliveries, error: deliveriesError }] = await Promise.all([
    fetchByIdBatches(studentIds, (batch) => supabaseAdmin.from('profiles')
      .select('user_id, email, phone, notification_preferences')
      .in('user_id', batch)
      .order('user_id', { ascending: true })),
    fetchByIdBatches(sourceKeys, (batch) => supabaseAdmin.from('notification_email_log')
      .select('source_key, user_id, email_status, email_id, email_to, sms_status, sms_message_id, sms_to')
      .in('source_key', batch)
      .order('source_key', { ascending: true })),
  ]);
  if (profilesError || deliveriesError) return json({ error: 'Unable to load recipient notification context' }, 500);
  const profileById = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
  const deliveryByKey = new Map((deliveries || []).map((delivery) => [delivery.source_key, delivery]));
  const scholarshipTitle = scholarship?.title || 'scholarship';
  const counts = { applicantCount: release.applicant_count, acceptedCount: release.accepted_count };
  const body = isOffers
    ? describeWaitlistLetter({ scholarshipTitle })
    : describeNonAcceptanceLetter({ scholarshipTitle, ...counts });
  const smsText = isOffers
    ? renderWaitlistLetterSms({ scholarshipTitle }).message
    : renderNonAcceptanceLetterSms({ scholarshipTitle, ...counts }).message;
  const resend = getResendConfig(env);
  const sms = getSmsConfig(env);
  let sent = 0;
  let ledgerFailed = 0;
  let recipientFailed = 0;

  await runBounded(rejected, DELIVERY_CONCURRENCY, async (application) => {
    const sourceKey = `results-release-${release.id}-${application.id}`;
    const studentProfile = profileById.get(application.student_id);
    const existing = deliveryByKey.get(sourceKey);
    const preferences = studentProfile?.notification_preferences ?? {};
    const message = renderApplicationStatusEmail({
      subject: `Scholarship results: ${scholarshipTitle}`,
      body,
      scholarshipTitle,
      status: letterStatus,
      siteUrl: resolveSiteUrl(env),
    });

    const letterWantsInApp = isInAppEnabledForUser(preferences);
    let letterInAppError = null;
    if (letterWantsInApp) {
      const { error: inAppError } = await supabaseAdmin.from('notifications').upsert({
        profile_id: application.student_id,
        title: message.subject,
        body,
        channel: 'In-app',
        status: 'Unread',
        source_key: sourceKey,
      }, { onConflict: 'profile_id,source_key', ignoreDuplicates: true });
      letterInAppError = inAppError;
      if (inAppError) logDeliveryFailure('results_release_in_app_write_failed', inAppError);
    }

    const emailAlreadySent = existing?.email_status === 'sent';
    const smsAlreadySent = existing?.sms_status === 'sent';
    const wantsEmail = !emailAlreadySent && isEmailEnabledForUser(preferences) && Boolean(studentProfile?.email);
    const smsTo = normalizePhilippineMobile(studentProfile?.phone);
    const wantsSms = isTrustedDatabaseCaller && !smsAlreadySent && isSmsEnabledForUser(preferences) && Boolean(smsTo);
    const emailResult = wantsEmail
      ? await sendEmail({
          apiKey: resend.apiKey,
          from: resend.from,
          to: studentProfile.email,
          subject: message.subject,
          html: message.html,
          text: message.text,
          idempotencyKey: `${sourceKey}:${application.student_id}`,
        })
      : { ok: false, skipped: true };
    const smsResult = wantsSms
      ? await sendSms({
          apiToken: sms.apiToken,
          phoneNumber: smsTo,
          message: smsText,
          provider: sms.provider,
        })
      : { ok: false, skipped: true };

    await recordDeliveryAttempts(supabaseAdmin, buildDeliveryAttempts({
      functionName: 'notify-application-status',
      sourceKey,
      userId: application.student_id,
      attempts: [
        inAppAttempt({ wanted: letterWantsInApp, error: letterInAppError }),
        ...(emailAlreadySent ? [] : [channelAttempt({ channel: 'email', wanted: wantsEmail, result: emailResult })]),
        ...(smsAlreadySent ? [] : [channelAttempt({ channel: 'sms', wanted: wantsSms, result: smsResult })]),
      ],
    }));

    if (emailResult.ok || smsResult.ok) {
      sent += 1;
      const { error: ledgerError } = await supabaseAdmin.from('notification_email_log').upsert({
        source_key: sourceKey,
        user_id: application.student_id,
        reminder_title: message.subject,
        email_to: emailResult.ok ? studentProfile.email : existing?.email_to ?? null,
        email_status: emailAlreadySent ? 'sent' : emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
        email_id: emailResult.id ?? existing?.email_id ?? null,
        email_error: emailResult.error ?? null,
        ...(isTrustedDatabaseCaller
          ? {
              sms_to: smsResult.ok ? (formatPhilippineMobile(studentProfile.phone) ?? smsTo) : existing?.sms_to ?? null,
              sms_status: smsAlreadySent ? 'sent' : smsResult.ok ? 'sent' : wantsSms ? 'failed' : 'skipped',
              sms_message_id: smsResult.messageId ?? existing?.sms_message_id ?? null,
              sms_error: smsResult.error ?? smsResult.reason ?? null,
            }
          : {
              sms_to: existing?.sms_to ?? null,
              sms_status: existing?.sms_status ?? null,
              sms_message_id: existing?.sms_message_id ?? null,
            }),
      }, { onConflict: 'source_key,user_id' });
      if (ledgerError) {
        ledgerFailed += 1;
        logDeliveryFailure('results_release_delivery_ledger_failed', ledgerError);
      }
    }
  }, (error) => {
    recipientFailed += 1;
    logDeliveryFailure('results_release_recipient_failed', error);
  });
  // A recipient whose work threw is reported as a server error, so the outbox
  // (20261105000006) retries the whole release; recipients already in the ledger
  // are skipped on the retry. A ledger-write failure alone is not retried: the
  // send already happened and repeating an SMS is not safe.
  return json(
    { ok: recipientFailed === 0, kind: release.kind || 'legacy', letters: rejected.length, sent, ledgerFailed, recipientFailed },
    recipientFailed === 0 ? 200 : 500,
  );
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const logDeliveryFailure = (event, error) => {
  if (!error) return;
  console.error(JSON.stringify({ event, code: error.code || 'unknown' }));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  // The database trigger presents the shared REMINDER_CRON_SECRET as its bearer
  // token, exactly like process-deadline-reminders. Any other token is treated
  // as a signed-in user's JWT and validated below. The check fails closed when
  // the secret is unset, and it is compared by exact value so a forged token
  // cannot authorize itself.
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET') ?? '';
  const isTrustedDatabaseCaller = Boolean(cronSecret) && token === cronSecret;

  if (!isTrustedDatabaseCaller && !token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let callerUserId = null;
  if (!isTrustedDatabaseCaller) {
    const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
    if (jwtError || !jwtUser?.user) {
      return json({ error: 'Unauthorized' }, 401);
    }
    callerUserId = jwtUser.user.id;
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  // The batch results release: only the database trigger or the Admin.
  if (payload?.mode === 'results-release') {
    const releaseId = String(payload?.releaseId ?? '').trim();
    if (!releaseId) return json({ error: 'releaseId is required' }, 400);
    if (!isTrustedDatabaseCaller) {
      const { data: releaseCaller } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('user_id', callerUserId)
        .maybeSingle();
      if (releaseCaller?.role !== 'admissions_admin') {
        return json({ error: 'Only the Admissions Office Admin can release results' }, 403);
      }
    }
    return sendResultsReleaseLetters({ supabaseAdmin, releaseId, isTrustedDatabaseCaller, env: Deno.env.toObject() });
  }

  const applicationId = String(payload?.applicationId ?? '').trim();
  if (!applicationId) {
    return json({ error: 'applicationId is required' }, 400);
  }

  const { data: application, error: applicationError } = await supabaseAdmin
    .from('applications')
    .select('id, student_id, scholarship_id, status, interview, release')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) {
    return json({ error: 'Unable to load the application' }, 500);
  }
  if (!application) {
    return json({ error: 'Application not found' }, 404);
  }

  const [{ data: callerProfile }, { data: studentProfile }] = await Promise.all([
    callerUserId
      ? supabaseAdmin
          .from('profiles')
          .select('role, department')
          .eq('user_id', callerUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from('profiles')
      .select('full_name, email, phone, department, notification_preferences')
      .eq('user_id', application.student_id)
      .maybeSingle(),
  ]);

  const callerRole = callerProfile?.role;
  // Both Admissions Office lanes can trigger the retry: Staff write the earlier
  // stages, the Admin writes approval and release.
  const isAdmissionsOffice = ['admissions_office', 'admissions_admin', 'osa_admin'].includes(callerRole);
  // A scoped reviewer (interviewer or ladder account) whose scope covers the
  // applicant, e.g. the interviewer's browser retrying after a recommendation.
  const isOwningChair = SCOPED_REVIEWER_ROLES.includes(callerRole)
    && await callerScopesToStudent(token, application.student_id);
  const isOwner = callerUserId != null && callerUserId === application.student_id;

  if (!isTrustedDatabaseCaller && !isAdmissionsOffice && !isOwningChair && !isOwner) {
    return json({ error: 'You are not allowed to notify this application' }, 403);
  }

  const status = application.status;
  // The outcome waits for the scholarship's batch release.
  if (HELD_STATUSES.includes(status)) {
    return json({ ok: true, sent: false, held: true, reason: 'Results are sent when the Admissions Office Admin releases them' });
  }
  const sourceKey = `application-status-${application.id}-${status}`;

  const { data: existingEmailDelivery, error: existingEmailLookupError } = await supabaseAdmin
    .from('notification_email_log')
    .select('source_key, email_status, email_id, email_to, sms_status, sms_message_id, sms_to')
    .eq('source_key', sourceKey)
    .eq('user_id', application.student_id)
    .maybeSingle();
  if (existingEmailLookupError) {
    return json({ error: 'Unable to check prior status notification delivery' }, 500);
  }

  const preferences = studentProfile?.notification_preferences ?? {};
  // Each channel is independently opt-in. The in-app event is separate from
  // the email/SMS delivery ledger, so an in-app-only preference still works.
  const wantsInApp = isInAppEnabledForUser(preferences);
  const emailAlreadySent = existingEmailDelivery?.email_status === 'sent';
  const smsAlreadySent = existingEmailDelivery?.sms_status === 'sent';
  const wantsEmail = !emailAlreadySent && isEmailEnabledForUser(preferences) && Boolean(studentProfile?.email);
  const smsTo = normalizePhilippineMobile(studentProfile?.phone);
  // The database trigger and a browser retry can run for the same status change
  // at almost the same moment. In-app dedupes on the source key and email on the
  // Resend idempotency key, but SMS has neither — so only the authoritative
  // database caller sends the text; the browser path covers the other channels.
  const wantsSms = isTrustedDatabaseCaller && !smsAlreadySent && isSmsEnabledForUser(preferences) && Boolean(smsTo);

  const { data: scholarship } = await supabaseAdmin
    .from('scholarships')
    .select('title')
    .eq('id', application.scholarship_id)
    .maybeSingle();

  // A database-triggered call has no user JWT, so the actor comes from the
  // append-only status log (20261014000002); the table may be absent while its
  // migration is pending, in which case the message reads "the system".
  let databaseActorRole = null;
  if (isTrustedDatabaseCaller) {
    const { data: logRow } = await supabaseAdmin
      .from('application_status_log')
      .select('actor_role')
      .eq('application_id', application.id)
      .eq('to_status', status)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    databaseActorRole = logRow?.actor_role ?? null;
  }

  const officeActorLabel = (role) => (role === 'admissions_admin'
    ? 'the Admissions Office Admin'
    : 'the Admissions Office Staff');
  const actorLabel = isOwner
    ? 'your submission'
    : isAdmissionsOffice
      ? officeActorLabel(callerRole)
      : isOwningChair
        ? 'your school'
        : databaseActorRole === 'admissions_office' || databaseActorRole === 'admissions_admin'
          ? officeActorLabel(databaseActorRole)
          : SCOPED_REVIEWER_ROLES.includes(databaseActorRole)
            ? 'your school'
            : databaseActorRole === 'student'
              ? 'your submission'
              : 'the system';

  const env = Deno.env.toObject();
  const resend = getResendConfig(env);
  const sms = getSmsConfig(env);
  // The first interview schedule rides this notification (SOP step 5), so the
  // Interview message carries the date, mode, and location or meeting link.
  const interview = status === 'Interview' ? application.interview : null;
  // The acceptance carries the date to confirm by and whether it came from the waitlist.
  const release = status === 'Released' ? application.release : null;
  const statusUpdate = describeApplicationStatusUpdate(status, actorLabel, { interview, release });
  const message = renderApplicationStatusEmail({
    subject: status === 'For Verification'
      ? 'Application update: documents under verification'
      : status === 'Released'
        ? `Scholarship results: ${scholarship?.title || 'scholarship'}`
        : `Application status: ${getStudentApplicationStatusLabel(status)}`,
    body: statusUpdate,
    scholarshipTitle: scholarship?.title || 'Scholarship application',
    status,
    siteUrl: resolveSiteUrl(env),
    interview,
  });

  let inAppSent = false;
  let inAppAlreadyExists = false;
  let inAppError = null;
  let ledgerFailed = false;
  if (wantsInApp) {
    const { error } = await supabaseAdmin
      .from('notifications')
      .upsert({
        profile_id: application.student_id,
        title: message.subject,
        body: `Your ${scholarship?.title || 'scholarship'} application: ${statusUpdate}`,
        channel: 'In-app',
        status: 'Unread',
        source_key: sourceKey,
      }, { onConflict: 'profile_id,source_key', ignoreDuplicates: true });
    inAppError = error;
    inAppAlreadyExists = !error;
    inAppSent = !error && !existingEmailDelivery;
  }

  const emailResult = emailAlreadySent
    ? { ok: false, skipped: true, reason: 'This status update was already emailed' }
    : wantsEmail
    ? await sendEmail({
        apiKey: resend.apiKey,
        from: resend.from,
        to: studentProfile.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: `${sourceKey}:${application.student_id}`,
      })
    : { ok: false, skipped: true, reason: 'Email notifications are disabled or no email address on file' };

  const smsResult = smsAlreadySent
    ? { ok: false, skipped: true, reason: 'This status update was already texted' }
    : wantsSms
    ? await sendSms({
        apiToken: sms.apiToken,
        phoneNumber: smsTo,
        message: renderApplicationStatusSms({
          scholarshipTitle: scholarship?.title,
          status,
          interview,
          release,
        }).message,
        provider: sms.provider,
      })
    : {
        ok: false,
        skipped: true,
        reason: isTrustedDatabaseCaller
          ? 'SMS notifications are disabled or no mobile number on file'
          : 'The database delivery path owns the SMS channel for this update',
      };

  await recordDeliveryAttempts(supabaseAdmin, buildDeliveryAttempts({
    functionName: 'notify-application-status',
    sourceKey,
    userId: application.student_id,
    attempts: [
      ...(wantsInApp ? [inAppAttempt({ wanted: true, error: inAppError })] : []),
      ...(emailAlreadySent ? [] : [channelAttempt({ channel: 'email', wanted: wantsEmail, result: emailResult })]),
      ...(smsAlreadySent ? [] : [channelAttempt({ channel: 'sms', wanted: wantsSms, result: smsResult })]),
    ],
  }));

  if (emailResult.ok || smsResult.ok) {
    // Log only real email/SMS deliveries. In-app rows have their own source-key
    // uniqueness and must not suppress a later retry of a failed gateway send.
    //
    // A browser caller never touches SMS, so it preserves whatever the database
    // path recorded there instead of overwriting it with a stale 'skipped'.
    const smsLedger = isTrustedDatabaseCaller
      ? {
          sms_to: smsResult.ok ? (formatPhilippineMobile(studentProfile.phone) ?? smsTo) : existingEmailDelivery?.sms_to ?? null,
          sms_status: smsAlreadySent ? 'sent' : smsResult.ok ? 'sent' : wantsSms ? 'failed' : 'skipped',
          sms_message_id: smsResult.messageId ?? existingEmailDelivery?.sms_message_id ?? null,
          sms_error: smsResult.error ?? smsResult.reason ?? null,
        }
      : {
          sms_to: existingEmailDelivery?.sms_to ?? null,
          sms_status: existingEmailDelivery?.sms_status ?? null,
          sms_message_id: existingEmailDelivery?.sms_message_id ?? null,
        };

    const { error: ledgerError } = await supabaseAdmin
      .from('notification_email_log')
      .upsert({
        source_key: sourceKey,
        user_id: application.student_id,
        reminder_title: message.subject,
        email_to: emailResult.ok ? studentProfile.email : existingEmailDelivery?.email_to ?? null,
        email_status: emailAlreadySent ? 'sent' : emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
        email_id: emailResult.id ?? existingEmailDelivery?.email_id ?? null,
        email_error: emailResult.error ?? null,
        ...smsLedger,
      }, { onConflict: 'source_key,user_id' });
    if (ledgerError) {
      ledgerFailed = true;
      logDeliveryFailure('application_status_delivery_ledger_failed', ledgerError);
    }
  }

  if (!emailResult.ok && !smsResult.ok && !inAppSent && !inAppAlreadyExists) {
    return json({
      ok: false,
      sent: false,
      skipped: !wantsInApp && Boolean(emailResult.skipped) && Boolean(smsResult.skipped),
      reason: inAppError?.message || emailResult.error || emailResult.reason || smsResult.error || smsResult.reason || 'Unable to send the status notification',
    });
  }

  return json({
    ok: true,
    sent: Boolean(emailResult.ok || smsResult.ok || inAppSent),
    inAppSent,
    emailSmsAlreadyDelivered: Boolean(emailAlreadySent || smsAlreadySent),
    ledgerFailed,
    to: emailResult.ok ? studentProfile.email : null,
    emailId: emailResult.id ?? null,
    smsTo: smsResult.ok ? smsTo : null,
    smsMessageId: smsResult.messageId ?? null,
  });
});
