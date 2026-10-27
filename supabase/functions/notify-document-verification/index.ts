// Supabase Edge Function: notify-document-verification
//
// Notifies a student when the Admissions Office verifies or rejects one of their
// Document Vault files. A database trigger calls it after the verification write
// (20261021000001), and the reviewer's browser calls it too as a retry. The
// document, its owner, the recorded reason, and the applications that use the
// file are re-read here so the request body cannot spoof any of them.
//
// Channels:
//   - Rejected: in-app, email and SMS, each carrying the recorded reason and
//     telling the student to replace the file from the application's details.
//   - Verified: in-app only, so an application with several files does not send
//     a burst of emails and texts.
//
// Deployed with verify_jwt disabled, like notify-application-status: the
// database caller presents the shared REMINDER_CRON_SECRET, and any other caller
// must be a signed-in Admissions Office Staff or Head account (Staff is the lane
// that verifies documents). Every channel dedupes on
// `document-verification-<documentId>-<status>-<decidedAtEpoch>`; SMS is sent
// only by the database caller because it has no idempotency key of its own.
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional), REMINDER_CRON_SECRET,
// IPROGSMS_API_TOKEN, IPROGSMS_PROVIDER (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isEmailEnabledForUser, isInAppEnabledForUser, renderDocumentRejectionEmail, resolveSiteUrl } from '../_shared/email.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';
import { formatPhilippineMobile, getSmsConfig, isSmsEnabledForUser, normalizePhilippineMobile, renderDocumentRejectionSms, sendSms } from '../_shared/sms.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Applications the student can still act on for this file: a Draft is fixed in
// the application workspace, the others through the replace action.
const ACTIONABLE_STATUSES = ['Draft', 'Submitted', 'Under Review', 'For Verification'];

const withPeriod = (value) => (/[.!?]$/.test(value) ? value : `${value}.`);

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
    if (!['admissions_office', 'admissions_head', 'osa_admin'].includes(callerProfile?.role)) {
      return json({ error: 'Only the Admissions Office can send document notifications' }, 403);
    }
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const documentId = String(payload?.documentId ?? '').trim();
  if (!documentId) {
    return json({ error: 'documentId is required' }, 400);
  }

  const { data: document, error: documentError } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError) {
    return json({ error: 'Unable to load the document' }, 500);
  }
  if (!document) {
    return json({ error: 'Document not found' }, 404);
  }

  const status = document.verification_status;
  if (!['Verified', 'Rejected'].includes(status)) {
    return json({ ok: true, sent: false, skipped: true, reason: `No notification for ${status}` });
  }
  const isRejected = status === 'Rejected';
  // Each decision has its own timestamp (20261021000000); a project with that
  // migration pending falls back to one notification per document and status.
  const decidedAt = document.verification_decided_at ? Math.floor(new Date(document.verification_decided_at).getTime() / 1000) : 'na';
  const sourceKey = `document-verification-${document.id}-${status}-${decidedAt}`;
  const title = document.title || 'Your document';
  const reason = String(document.rejection_reason ?? '').trim();

  const [{ data: studentProfile }, { data: links }, { data: existingDelivery, error: existingLookupError }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('email, phone, notification_preferences')
      .eq('user_id', document.owner_id)
      .maybeSingle(),
    supabaseAdmin
      .from('application_documents')
      .select('applications(status, scholarships(title))')
      .eq('document_id', document.id),
    supabaseAdmin
      .from('notification_email_log')
      .select('email_status, email_id, email_to, sms_status, sms_message_id, sms_to')
      .eq('source_key', sourceKey)
      .eq('user_id', document.owner_id)
      .maybeSingle(),
  ]);
  if (existingLookupError) {
    return json({ error: 'Unable to check prior document notification delivery' }, 500);
  }

  const scholarshipTitles = [...new Set((links ?? [])
    .map((link) => link.applications)
    .filter((application) => application && ACTIONABLE_STATUSES.includes(application.status))
    .map((application) => application.scholarships?.title)
    .filter(Boolean))];

  const preferences = studentProfile?.notification_preferences ?? {};
  const env = Deno.env.toObject();

  let inAppError = null;
  if (isInAppEnabledForUser(preferences)) {
    const body = isRejected
      ? `The Admissions Office reverted “${title}” for resubmission.${reason ? ` What to correct: ${withPeriod(reason)}` : ''} ${scholarshipTitles.length
        ? `Replace the file from the application details under Applications (${scholarshipTitles.join(', ')}) so the review can continue.`
        : 'Upload a corrected file to your Document Vault.'}`
      : `The Admissions Office verified “${title}”. Any profile attributes it proves are now verified.`;
    const { error } = await supabaseAdmin
      .from('notifications')
      .upsert({
        profile_id: document.owner_id,
        title: isRejected ? `${title} needs to be resubmitted` : `${title} verified`,
        body,
        channel: 'In-app',
        status: 'Unread',
        source_key: sourceKey,
      }, { onConflict: 'profile_id,source_key', ignoreDuplicates: true });
    inAppError = error;
  }

  if (!isRejected) {
    return json({ ok: !inAppError, sent: !inAppError, reason: inAppError?.message ?? null });
  }

  const emailAlreadySent = existingDelivery?.email_status === 'sent';
  const smsAlreadySent = existingDelivery?.sms_status === 'sent';
  const wantsEmail = !emailAlreadySent && isEmailEnabledForUser(preferences) && Boolean(studentProfile?.email);
  const smsTo = normalizePhilippineMobile(studentProfile?.phone);
  const wantsSms = isTrustedDatabaseCaller && !smsAlreadySent && isSmsEnabledForUser(preferences) && Boolean(smsTo);

  const resend = getResendConfig(env);
  const sms = getSmsConfig(env);
  const message = renderDocumentRejectionEmail({
    documentTitle: title,
    reason,
    scholarshipTitles,
    siteUrl: resolveSiteUrl(env),
  });

  const emailResult = emailAlreadySent
    ? { ok: false, skipped: true, reason: 'This decision was already emailed' }
    : wantsEmail
    ? await sendEmail({
        apiKey: resend.apiKey,
        from: resend.from,
        to: studentProfile.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: `${sourceKey}:${document.owner_id}`,
      })
    : { ok: false, skipped: true, reason: 'Email notifications are disabled or no email address on file' };

  const smsResult = smsAlreadySent
    ? { ok: false, skipped: true, reason: 'This decision was already texted' }
    : wantsSms
    ? await sendSms({
        apiToken: sms.apiToken,
        phoneNumber: smsTo,
        message: renderDocumentRejectionSms({ documentTitle: title, reason }).message,
        provider: sms.provider,
      })
    : {
        ok: false,
        skipped: true,
        reason: isTrustedDatabaseCaller
          ? 'SMS notifications are disabled or no mobile number on file'
          : 'The database delivery path owns the SMS channel for this decision',
      };

  // Log only real email/SMS deliveries so a skipped or failed send stays
  // retryable; a browser caller preserves whatever the database path recorded
  // for SMS.
  if (emailResult.ok || smsResult.ok) {
    const smsLedger = isTrustedDatabaseCaller
      ? {
          sms_to: smsResult.ok ? (formatPhilippineMobile(studentProfile.phone) ?? smsTo) : existingDelivery?.sms_to ?? null,
          sms_status: smsAlreadySent ? 'sent' : smsResult.ok ? 'sent' : wantsSms ? 'failed' : 'skipped',
          sms_message_id: smsResult.messageId ?? existingDelivery?.sms_message_id ?? null,
          sms_error: smsResult.error ?? smsResult.reason ?? null,
        }
      : {
          sms_to: existingDelivery?.sms_to ?? null,
          sms_status: existingDelivery?.sms_status ?? null,
          sms_message_id: existingDelivery?.sms_message_id ?? null,
        };
    await supabaseAdmin
      .from('notification_email_log')
      .upsert({
        source_key: sourceKey,
        user_id: document.owner_id,
        reminder_title: message.subject,
        email_to: emailResult.ok ? studentProfile.email : existingDelivery?.email_to ?? null,
        email_status: emailAlreadySent ? 'sent' : emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
        email_id: emailResult.id ?? existingDelivery?.email_id ?? null,
        email_error: emailResult.error ?? null,
        ...smsLedger,
      });
  }

  return json({
    ok: !inAppError || emailResult.ok || smsResult.ok,
    inAppError: inAppError?.message ?? null,
    emailSent: Boolean(emailResult.ok),
    smsSent: Boolean(smsResult.ok),
    emailReason: emailResult.error ?? emailResult.reason ?? null,
    smsReason: smsResult.error ?? smsResult.reason ?? null,
  });
});
