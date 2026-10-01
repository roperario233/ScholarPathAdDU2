// Supabase Edge Function: notify-application-status
//
// Emails a student when their application status changes. The application
// workspace calls this after writing the new status, but the authoritative
// content (recipient, status, scholarship) is re-read here so the request body
// cannot spoof who receives the message.
//
// Deployed with verify_jwt enabled. The caller must be an OSA administrator,
// the Department Chair responsible for the student's department, or the student
// who owns the application (which covers a self-service submission).
//
// A record is written to notification_email_log keyed by
// `application-status-<applicationId>-<status>` so a repeated save never
// re-emails the same transition.
//
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isEmailEnabledForUser, renderApplicationStatusEmail, resolveSiteUrl } from '../_shared/email.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';

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
      .select('full_name, email, department, notification_preferences')
      .eq('user_id', application.student_id)
      .maybeSingle(),
  ]);

  const callerRole = callerProfile?.role;
  const isOsaAdmin = callerRole === 'osa_admin';
  const isOwningChair = callerRole === 'department_chair'
    && Boolean(studentProfile?.department)
    && callerProfile?.department === studentProfile?.department;
  const isOwner = jwtUser.user.id === application.student_id;

  if (!isOsaAdmin && !isOwningChair && !isOwner) {
    return json({ error: 'You are not allowed to notify this application' }, 403);
  }

  const status = application.status;
  const sourceKey = `application-status-${application.id}-${status}`;

  const { data: existing } = await supabaseAdmin
    .from('notification_email_log')
    .select('source_key')
    .eq('source_key', sourceKey)
    .eq('user_id', application.student_id)
    .maybeSingle();
  if (existing) {
    return json({ ok: true, sent: false, skipped: true, reason: 'This status update was already emailed' });
  }

  const preferences = studentProfile?.notification_preferences ?? {};
  if (!isEmailEnabledForUser(preferences)) {
    return json({ ok: true, sent: false, skipped: true, reason: 'Email notifications are disabled for this student' });
  }
  if (!studentProfile?.email) {
    return json({ ok: true, sent: false, skipped: true, reason: 'This student has no email address on file' });
  }

  const { data: scholarship } = await supabaseAdmin
    .from('scholarships')
    .select('title')
    .eq('id', application.scholarship_id)
    .maybeSingle();

  const actorLabel = isOwner
    ? 'your submission'
    : isOsaAdmin ? 'the Office of Student Affairs' : 'your Department Chair';

  const env = Deno.env.toObject();
  const resend = getResendConfig(env);
  const message = renderApplicationStatusEmail({
    subject: `Application status: ${status}`,
    body: `Your application status was updated to ${status} through ${actorLabel}. Sign in to review the next steps.`,
    scholarshipTitle: scholarship?.title || 'Scholarship application',
    status,
    siteUrl: resolveSiteUrl(env),
  });

  const result = await sendEmail({
    apiKey: resend.apiKey,
    from: resend.from,
    to: studentProfile.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    idempotencyKey: `${sourceKey}:${application.student_id}`,
  });

  if (!result.ok) {
    return json({
      ok: false,
      sent: false,
      skipped: Boolean(result.skipped),
      reason: result.error || result.reason || 'Unable to send the status email',
    });
  }

  await supabaseAdmin
    .from('notification_email_log')
    .upsert({
      source_key: sourceKey,
      user_id: application.student_id,
      reminder_title: message.subject,
      email_to: studentProfile.email,
      email_status: 'sent',
      email_id: result.id ?? null,
      email_error: null,
    });

  return json({ ok: true, sent: true, to: studentProfile.email, emailId: result.id });
});
