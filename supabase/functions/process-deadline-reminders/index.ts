// Supabase Edge Function: process-deadline-reminders
//
// Server-side reminder trigger. Intended to be invoked on a schedule via
// pg_cron + pg_net (see the scheduling block at the bottom of
// supabase/schema.sql).
//
// Computes the deadline reminders that are due today (Manila calendar) from
// active scholarships, non-terminal applications, and persisted custom
// deadlines; writes the in-app notification, emails the recipient through
// Resend, texts the recipient through iprogSMS on the scheduled run, and
// records every delivery in notification_email_log so a reminder reaches a
// given student at most once.
//
// The execution lives in ../_shared/deadlineReminderRunner.js so the paging,
// grouping, dedupe, and failure-isolation behavior can be tested without Deno
// or a deployed project. This file keeps only transport: CORS, authorization,
// and the JSON response.
//
// Each channel is independently opt-in, matching the notification center
// settings: the in-app row honors `inAppEnabled`, and the email and SMS honor
// `emailEnabled` / `smsEnabled` plus the 7-day / 3-day / 1-day reminder toggles.
//
// A scheduled interview (SOP step 5) gets the 1-day reminder on the same
// channels, keyed `interview-reminder-<applicationId>-<revision>-1` like the
// in-app row the app generates locally, so a reschedule earns a new reminder.
//
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional), REMINDER_CRON_SECRET,
// IPROGSMS_API_TOKEN, IPROGSMS_PROVIDER (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { manilaDateKey } from '../_shared/reminders.js';
import { runDeadlineReminders } from '../_shared/deadlineReminderRunner.js';

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
  // This function is deployed with verify_jwt disabled, because the scheduled
  // caller (pg_cron via pg_net) presents a shared secret rather than a JWT, and
  // the platform-level JWT check rejects service role keys. Authorization is
  // enforced here instead: the caller must present the dedicated cron secret, or
  // be a signed-in user for manual on-demand runs.
  //
  // The check fails closed when REMINDER_CRON_SECRET is unset, and the token is
  // compared by exact value rather than by inspecting a JWT role claim, so a
  // forged token cannot authorize itself.
  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET') ?? '';

  if (!authorizationHeader || !token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  if (!cronSecret || token !== cronSecret) {
    // Not the scheduled caller, so fall back to a signed-in user JWT.
    const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
    if (jwtError || !jwtUser?.user) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }
  const isScheduledCaller = Boolean(cronSecret) && token === cronSecret;

  // The reminder rule is evaluated against the Manila calendar.
  const today = manilaDateKey();

  try {
    const result = await runDeadlineReminders({
      supabase: supabaseAdmin,
      today,
      env: Deno.env.toObject(),
      // SMS is sent only by the trusted scheduled caller; a manual signed-in
      // run still writes in-app rows and emails, but cannot text students.
      allowSms: isScheduledCaller,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: String(error?.message ?? error) }, 500);
  }
});
