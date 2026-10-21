// Supabase Edge Function: manage-interview-event
//
// Optional Google Calendar and Meet integration for SOP step 5 interviews. The
// Admissions Office browser calls it while scheduling, rescheduling, or
// cancelling an interview:
//   * { action: 'status' }  -> { ok, configured }
//   * { action: 'create' | 'update', applicationId, eventId?, schedule }
//       -> { ok, configured, eventId, htmlLink, meetingUrl }
//   * { action: 'cancel', applicationId, eventId } -> { ok, configured }
//
// The app saves the panel first, so the attendee list is re-read here from the
// database: the student (profiles.email), each account panelist (a Department
// Chair from the applicant's school, SOP 5a), and each faculty guest with an
// email. The guest list is hidden from guests, so the applicant never sees the
// panel through the invitation. An online interview without a pasted link gets
// a generated Google Meet link.
//
// Without the Google secrets the function answers { configured: false } and
// the app falls back to a pasted meeting link plus "Add to Google Calendar" and
// the .ics file. Google failures answer 200 with { ok: false, reason } so the
// browser can show the reason.
//
// Deployed with verify_jwt disabled like the other functions; only a signed-in
// Admissions Office Staff or Head account may call it.
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID (optional, default primary).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildGoogleInterviewEvent,
  cancelGoogleInterviewEvent,
  fetchGoogleAccessToken,
  getGoogleCalendarConfig,
  upsertGoogleInterviewEvent,
} from '../_shared/googleCalendar.js';
import { INTERVIEW_DURATIONS } from '../_shared/interview.js';

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
  const action = String(payload?.action ?? '').trim();
  const config = getGoogleCalendarConfig(Deno.env.toObject());

  if (action === 'status') {
    return json({ ok: true, configured: config.configured });
  }
  if (!['create', 'update', 'cancel'].includes(action)) {
    return json({ error: 'Unknown action' }, 400);
  }
  if (!config.configured) {
    return json({ ok: false, configured: false, reason: 'The Google Calendar integration is not configured' });
  }

  const applicationId = String(payload?.applicationId ?? '').trim();
  const eventId = String(payload?.eventId ?? '').trim();
  if (!applicationId) {
    return json({ error: 'applicationId is required' }, 400);
  }
  if ((action === 'update' || action === 'cancel') && !eventId) {
    return json({ error: 'eventId is required' }, 400);
  }

  const { data: application } = await supabaseAdmin
    .from('applications')
    .select('id, student_id, scholarship_id, status')
    .eq('id', applicationId)
    .maybeSingle();
  if (!application) {
    return json({ error: 'Application not found' }, 404);
  }

  const auth = await fetchGoogleAccessToken(config);
  if (!auth.ok) {
    return json({ ok: false, configured: true, reason: `Google sign-in failed: ${auth.error}` });
  }

  if (action === 'cancel') {
    const result = await cancelGoogleInterviewEvent({ config, accessToken: auth.accessToken, eventId });
    return json({ ok: result.ok, configured: true, reason: result.error ?? null });
  }

  if (!['Endorsed', 'Interview'].includes(application.status)) {
    return json({ error: 'This application is not at the interview stage' }, 409);
  }
  const schedule = payload?.schedule ?? {};
  const startsAt = new Date(String(schedule.startsAt ?? ''));
  if (Number.isNaN(startsAt.getTime()) || !['onsite', 'online'].includes(schedule.mode)
    || !INTERVIEW_DURATIONS.includes(Number(schedule.durationMinutes))) {
    return json({ error: 'A valid schedule is required' }, 400);
  }

  const [{ data: scholarship }, { data: student }, { data: panelRows }] = await Promise.all([
    supabaseAdmin.from('scholarships').select('title').eq('id', application.scholarship_id).maybeSingle(),
    supabaseAdmin.from('profiles').select('full_name, email, department').eq('user_id', application.student_id).maybeSingle(),
    supabaseAdmin
      .from('application_interview_panelists')
      .select('profile_id, guest_name, guest_email')
      .eq('application_id', application.id)
      .is('removed_at', null),
  ]);
  const accountIds = (panelRows ?? []).map((row) => row.profile_id).filter(Boolean);
  const { data: accountProfiles } = accountIds.length
    ? await supabaseAdmin.from('profiles').select('user_id, full_name, email').in('user_id', accountIds)
    : { data: [] };

  const attendees = [
    { email: student?.email, name: student?.full_name },
    ...(accountProfiles ?? []).map((row) => ({ email: row.email, name: row.full_name })),
    ...(panelRows ?? []).filter((row) => !row.profile_id && row.guest_email).map((row) => ({ email: row.guest_email, name: row.guest_name })),
  ].filter((entry, index, list) => entry.email && list.findIndex((other) => other.email === entry.email) === index);

  const event = buildGoogleInterviewEvent({
    schedule: {
      mode: schedule.mode,
      startsAt: startsAt.toISOString(),
      durationMinutes: Number(schedule.durationMinutes),
      locationLabel: String(schedule.locationLabel ?? ''),
      meetingUrl: String(schedule.meetingUrl ?? ''),
      instructions: String(schedule.instructions ?? ''),
    },
    scholarshipTitle: scholarship?.title || '',
    school: student?.department || '',
    attendees,
    requestId: crypto.randomUUID(),
  });
  if (action === 'update' && schedule.mode === 'onsite') {
    // Switching an online interview to on-site drops its Meet conference.
    event.conferenceData = null;
  }

  const result = await upsertGoogleInterviewEvent({
    config,
    accessToken: auth.accessToken,
    event,
    eventId: action === 'update' ? eventId : null,
  });
  if (!result.ok) {
    return json({ ok: false, configured: true, reason: result.error });
  }
  return json({ ok: true, configured: true, eventId: result.eventId, htmlLink: result.htmlLink, meetingUrl: result.meetingUrl });
});
