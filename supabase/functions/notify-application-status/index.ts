// Supabase Edge Function: notify-application-status
//
// Notifies a student (in-app, email and SMS) when their application status changes.
// The application workspace calls this after writing the new status, but the
// authoritative content (recipient, status, scholarship) is re-read here so
// the request body cannot spoof who receives the message.
//
// Deployed with verify_jwt enabled. The caller must be an Admissions Office administrator,
// the Department Chair responsible for the student's department, or the student
// who owns the application (which covers a self-service submission).
//
// A record is written to notification_email_log keyed by
// `application-status-<applicationId>-<status>` so a repeated save never
// re-sends the same transition on either channel. The email and SMS channels
// The email, SMS and in-app channels follow the student's notification preferences.
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional), IPROGSMS_API_TOKEN,
// IPROGSMS_PROVIDER (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isEmailEnabledForUser, isInAppEnabledForUser, renderApplicationStatusEmail, resolveSiteUrl } from '../_shared/email.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';
import { formatPhilippineMobile, getSmsConfig, isSmsEnabledForUser, normalizePhilippineMobile, renderApplicationStatusSms, sendSms } from '../_shared/sms.js';

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

  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
  if (jwtError || !jwtUser?.user) {
    return json({ error: 'Unauthorized' }, 401);
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
    .select('id, student_id, scholarship_id, status')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) {
    return json({ error: 'Unable to load the application' }, 500);
  }
  if (!application) {
    return json({ error: 'Application not found' }, 404);
  }

  const [{ data: callerProfile }, { data: studentProfile }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('role, department')
      .eq('user_id', jwtUser.user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('full_name, email, phone, department, notification_preferences')
      .eq('user_id', application.student_id)
      .maybeSingle(),
  ]);

  const callerRole = callerProfile?.role;
  const isAdmissionsOffice = callerRole === 'admissions_office' || callerRole === 'osa_admin';
  const isOwningChair = callerRole === 'department_chair'
    && Boolean(studentProfile?.department)
    && callerProfile?.department === studentProfile?.department;
  const isOwner = jwtUser.user.id === application.student_id;

  if (!isAdmissionsOffice && !isOwningChair && !isOwner) {
    return json({ error: 'You are not allowed to notify this application' }, 403);
  }

  const status = application.status;
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
  const wantsSms = !smsAlreadySent && isSmsEnabledForUser(preferences) && Boolean(smsTo);

  const { data: scholarship } = await supabaseAdmin
    .from('scholarships')
    .select('title')
    .eq('id', application.scholarship_id)
    .maybeSingle();

  const actorLabel = isOwner
    ? 'your submission'
    : isAdmissionsOffice ? 'the Admissions Office' : 'your Department Chair';

  const env = Deno.env.toObject();
  const resend = getResendConfig(env);
  const sms = getSmsConfig(env);
  const message = renderApplicationStatusEmail({
    subject: `Application status: ${status}`,
    body: `Your application status was updated to ${status} through ${actorLabel}. Sign in to review the next steps.`,
    scholarshipTitle: scholarship?.title || 'Scholarship application',
    status,
    siteUrl: resolveSiteUrl(env),
  });

  let inAppSent = false;
  let inAppAlreadyExists = false;
  let inAppError = null;
  if (wantsInApp) {
    const { error } = await supabaseAdmin
      .from('notifications')
      .upsert({
        profile_id: application.student_id,
        title: message.subject,
        body: `Your ${scholarship?.title || 'scholarship'} application status changed to ${status} through ${actorLabel}. Open your application workspace to review the update.`,
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
        }).message,
        provider: sms.provider,
      })
    : { ok: false, skipped: true, reason: 'SMS notifications are disabled or no mobile number on file' };

  if (emailResult.ok || smsResult.ok) {
    // Log only real email/SMS deliveries. In-app rows have their own source-key
    // uniqueness and must not suppress a later retry of a failed gateway send.
    await supabaseAdmin
      .from('notification_email_log')
      .upsert({
        source_key: sourceKey,
        user_id: application.student_id,
        reminder_title: message.subject,
        email_to: emailResult.ok ? studentProfile.email : existingEmailDelivery?.email_to ?? null,
        email_status: emailAlreadySent ? 'sent' : emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
        email_id: emailResult.id ?? existingEmailDelivery?.email_id ?? null,
        email_error: emailResult.error ?? null,
        sms_to: smsResult.ok ? (formatPhilippineMobile(studentProfile.phone) ?? smsTo) : existingEmailDelivery?.sms_to ?? null,
        sms_status: smsAlreadySent ? 'sent' : smsResult.ok ? 'sent' : wantsSms ? 'failed' : 'skipped',
        sms_message_id: smsResult.messageId ?? existingEmailDelivery?.sms_message_id ?? null,
        sms_error: smsResult.error ?? smsResult.reason ?? null,
      });
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
    to: emailResult.ok ? studentProfile.email : null,
    emailId: emailResult.id ?? null,
    smsTo: smsResult.ok ? smsTo : null,
    smsMessageId: smsResult.messageId ?? null,
  });
});
