// Supabase Edge Function: manage-interview-event
//
// Google Calendar and Meet for SOP step 5 interviews. The Admissions Office
// browser calls it while scheduling, rescheduling, cancelling, or repairing an
// interview:
//   * { action: 'status' }  -> { ok, configured }
//   * { action: 'verify' }  -> { ok, configured, calendarId, calendar?, code?, reason? }
//   * { action: 'create' | 'update', applicationId, eventId?, schedule }
//   * { action: 'cancel', applicationId, eventId }
//   * { action: 'sync', applicationId }   (repair: reconcile Google with the record)
//
// This file is transport only: CORS, the JWT check, the Admissions Office role
// gate, and JSON. Everything else lives in ../_shared/interviewEvent.js so the
// behavior is unit-testable without a Deno runtime.
//
// The attendee list is always re-read server-side (the student, each account
// panelist from the applicant's school per SOP 5a, and each faculty guest with an
// email), and the guest list is hidden from guests, so the applicant never sees
// the panel through the invitation. An online interview without a pasted link
// gets a generated Google Meet link.
//
// Without the Google secrets the function answers { configured: false } and the
// app falls back to a pasted meeting link plus "Add to Google Calendar" and the
// .ics file. Google failures answer 200 with { ok: false, code, reason } so the
// browser can explain what to fix.
//
// Deployed with verify_jwt disabled like the other functions; only a signed-in
// Admissions Office Staff or Head account may call it.
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID (default primary).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getGoogleCalendarConfig } from '../_shared/googleCalendar.js';
import { handleInterviewEvent } from '../_shared/interviewEvent.js';

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
  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', jwtUser.user.id)
    .maybeSingle();
  if (!['admissions_office', 'admissions_head'].includes(callerProfile?.role)) {
    return json({ error: 'Only the Admissions Office can manage interview events' }, 403);
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const { httpStatus, body } = await handleInterviewEvent({
    action: payload?.action,
    payload,
    config: getGoogleCalendarConfig(Deno.env.toObject()),
    supabase: supabaseAdmin,
  });
  return json(body, httpStatus);
});
