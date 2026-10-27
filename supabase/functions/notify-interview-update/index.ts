// Supabase Edge Function: notify-interview-update
//
// SOP step 5 — Interview of applicants. Called by a database trigger whenever
// an interview's revision or state changes (20261029000001), and by the
// coordinating Admissions Office browser as a retry. The application, the
// interview, the student, and the panel are re-read here so the request body
// cannot spoof any recipient.
//
// Who hears what:
//   * Each account panelist (a Department Chair from the applicant's school,
//     SOP 5a) is told about every new revision of the schedule and about a
//     cancellation: in-app and email.
//   * The student is told about a reschedule (revision > 1) or a cancellation:
//     in-app, email, and SMS. The first schedule also moves the application to
//     `Interview`, so notify-application-status already told the student.
//   * Faculty guests have no account; they receive the Google Calendar
//     invitation when manage-interview-event is configured.
//   * Attendance is not tracked, so a legacy `completed` / `no_show` state
//     change (recorded before it was removed) notifies no one.
//
// Deployed with verify_jwt disabled, like the other notification functions:
// the database caller presents the shared REMINDER_CRON_SECRET, and any other
// caller must be a signed-in Admissions Office Staff or Head account. Every
// channel dedupes on its source key (`interview-update-<id>-<revision>-<state>`
// for the student, `interview-panel-<id>-<revision>-<state>` for a panelist);
// SMS is sent only by the database caller because it has no idempotency key.
// Required secrets: RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME
// (optional), APP_SITE_URL (optional), REMINDER_CRON_SECRET, IPROGSMS_API_TOKEN,
// IPROGSMS_PROVIDER (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isEmailEnabledForUser, isInAppEnabledForUser, renderInterviewUpdateEmail, resolveSiteUrl } from '../_shared/email.js';
import { isStructuredInterview, summarizeInterview } from '../_shared/interview.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';
import { formatPhilippineMobile, getSmsConfig, isSmsEnabledForUser, normalizePhilippineMobile, renderInterviewUpdateSms, sendSms } from '../_shared/sms.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
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

  if (!isTrustedDatabaseCaller) {
    const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
    if (jwtError || !jwtUser?.user) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('user_id', jwtUser.user.id)
      .maybeSingle();
    if (!['admissions_office', 'admissions_head'].includes(callerProfile?.role)) {
      return json({ error: 'Only the Admissions Office can send interview notifications' }, 403);
    }
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const applicationId = String(payload?.applicationId ?? '').trim();
  if (!applicationId) {
    return json({ error: 'applicationId is required' }, 400);
  }

  const { data: application, error: applicationError } = await supabaseAdmin
    .from('applications')
    .select('id, student_id, scholarship_id, status, interview')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) {
    return json({ error: 'Unable to load the application' }, 500);
  }
  if (!application) {
    return json({ error: 'Application not found' }, 404);
  }

  const interview = application.interview;
  if (application.status !== 'Interview' || !isStructuredInterview(interview)) {
    return json({ ok: true, skipped: true, reason: 'No structured interview to announce' });
  }
  const state = interview.state;
  // The interview stage records a schedule only. `completed` and `no_show` are
  // legacy states from before attendance tracking was removed, and a
  // legacy record's change is not announced.
  if (!['scheduled', 'cancelled'].includes(state)) {
    return json({ ok: true, skipped: true, reason: `No notification for the ${state} interview state` });
  }
  const revision = Number(interview.revision) || 1;
  const kind = state === 'cancelled' ? 'cancelled' : revision > 1 ? 'rescheduled' : 'scheduled';
  const lastChange = Array.isArray(interview.history) && interview.history.length ? interview.history[interview.history.length - 1] : null;
  const reason = kind === 'scheduled' ? '' : String(lastChange?.reason ?? '').trim();

  const [{ data: scholarship }, { data: student }, { data: panelRows }] = await Promise.all([
    supabaseAdmin.from('scholarships').select('title').eq('id', application.scholarship_id).maybeSingle(),
    supabaseAdmin.from('profiles').select('user_id, full_name, email, phone, notification_preferences').eq('user_id', application.student_id).maybeSingle(),
    supabaseAdmin
      .from('application_interview_panelists')
      .select('profile_id')
      .eq('application_id', application.id)
      .is('removed_at', null)
      .not('profile_id', 'is', null),
  ]);
  const panelistIds = [...new Set((panelRows ?? []).map((row) => row.profile_id).filter(Boolean))];
  const { data: panelists } = panelistIds.length
    ? await supabaseAdmin.from('profiles').select('user_id, full_name, email, notification_preferences').in('user_id', panelistIds)
    : { data: [] };

  const env = Deno.env.toObject();
  const resend = getResendConfig(env);
  const sms = getSmsConfig(env);
  const siteUrl = resolveSiteUrl(env);
  const scholarshipTitle = scholarship?.title || 'Scholarship application';
  const applicantName = student?.full_name || 'Applicant';

  // One recipient on one source key: an in-app row, an email, and (database
  // caller only) a text. Only real email/SMS deliveries are logged, so a skipped
  // or failed send stays retryable.
  const deliver = async ({ recipient, sourceKey, message, inApp, smsMessage = null }) => {
    const preferences = recipient?.notification_preferences ?? {};
    const { data: existing } = await supabaseAdmin
      .from('notification_email_log')
      .select('email_status, email_id, email_to, sms_status, sms_message_id, sms_to')
      .eq('source_key', sourceKey)
      .eq('user_id', recipient.user_id)
      .maybeSingle();

    let inAppError = null;
    if (isInAppEnabledForUser(preferences)) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .upsert({
          profile_id: recipient.user_id,
          title: inApp.title,
          body: inApp.body,
          channel: 'In-app',
          status: 'Unread',
          source_key: sourceKey,
        }, { onConflict: 'profile_id,source_key', ignoreDuplicates: true });
      inAppError = error;
    }

    const emailAlreadySent = existing?.email_status === 'sent';
    const smsAlreadySent = existing?.sms_status === 'sent';
    const wantsEmail = !emailAlreadySent && isEmailEnabledForUser(preferences) && Boolean(recipient.email);
    const smsTo = smsMessage ? normalizePhilippineMobile(recipient.phone) : null;
    const wantsSms = Boolean(smsMessage) && isTrustedDatabaseCaller && !smsAlreadySent && isSmsEnabledForUser(preferences) && Boolean(smsTo);

    const emailResult = wantsEmail
      ? await sendEmail({
          apiKey: resend.apiKey,
          from: resend.from,
          to: recipient.email,
          subject: message.subject,
          html: message.html,
          text: message.text,
          idempotencyKey: `${sourceKey}:${recipient.user_id}`,
        })
      : { ok: false, skipped: true, reason: emailAlreadySent ? 'Already emailed' : 'Email notifications are disabled or no email address on file' };
    const smsResult = wantsSms
      ? await sendSms({ apiToken: sms.apiToken, phoneNumber: smsTo, message: smsMessage, provider: sms.provider })
      : { ok: false, skipped: true };

    if (emailResult.ok || smsResult.ok) {
      const smsLedger = isTrustedDatabaseCaller && smsMessage
        ? {
            sms_to: smsResult.ok ? (formatPhilippineMobile(recipient.phone) ?? smsTo) : existing?.sms_to ?? null,
            sms_status: smsAlreadySent ? 'sent' : smsResult.ok ? 'sent' : wantsSms ? 'failed' : 'skipped',
            sms_message_id: smsResult.messageId ?? existing?.sms_message_id ?? null,
            sms_error: smsResult.error ?? smsResult.reason ?? null,
          }
        : {
            sms_to: existing?.sms_to ?? null,
            sms_status: existing?.sms_status ?? null,
            sms_message_id: existing?.sms_message_id ?? null,
          };
      await supabaseAdmin
        .from('notification_email_log')
        .upsert({
          source_key: sourceKey,
          user_id: recipient.user_id,
          reminder_title: message.subject,
          email_to: emailResult.ok ? recipient.email : existing?.email_to ?? null,
          email_status: emailAlreadySent ? 'sent' : emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
          email_id: emailResult.id ?? existing?.email_id ?? null,
          email_error: emailResult.error ?? null,
          ...smsLedger,
        }, { onConflict: 'source_key,user_id' });
    }

    return {
      recipient: recipient.user_id,
      inAppError: inAppError?.message ?? null,
      emailSent: Boolean(emailResult.ok),
      smsSent: Boolean(smsResult.ok),
    };
  };

  const results = [];
  const summary = summarizeInterview(interview);

  if (kind !== 'scheduled' && student?.user_id) {
    const message = renderInterviewUpdateEmail({ audience: 'student', kind, interview, scholarshipTitle, reason, siteUrl });
    results.push(await deliver({
      recipient: student,
      sourceKey: `interview-update-${application.id}-${revision}-${state}`,
      message,
      inApp: {
        title: message.subject,
        body: kind === 'cancelled'
          ? `Your ${scholarshipTitle} interview was cancelled.${reason ? ` Reason: ${reason}.` : ''} You will be notified if it is scheduled again.`
          : `Your ${scholarshipTitle} interview was rescheduled: ${summary}.`,
      },
      smsMessage: renderInterviewUpdateSms({ kind, interview, scholarshipTitle }).message,
    }));
  }

  for (const panelist of panelists ?? []) {
    const message = renderInterviewUpdateEmail({ audience: 'panelist', kind, interview, scholarshipTitle, applicantName, reason, siteUrl });
    results.push(await deliver({
      recipient: panelist,
      sourceKey: `interview-panel-${application.id}-${revision}-${state}`,
      message,
      inApp: {
        title: message.subject,
        body: kind === 'cancelled'
          ? `The ${scholarshipTitle} interview for ${applicantName} was cancelled.`
          : `You are on the ${scholarshipTitle} interview panel for ${applicantName}: ${summary}. Review the schedule and add your evaluation in the application's Interview tab after the interview.`,
      },
    }));
  }

  return json({ ok: true, kind, results });
});
