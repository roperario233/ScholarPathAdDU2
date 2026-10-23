/**
 * The Google Calendar side of SOP step 5, independent of Deno and of Supabase's
 * client so vitest can exercise it.
 *
 * `manage-interview-event/index.ts` keeps only the transport concerns (CORS, the
 * JWT check, the Admissions Office role gate, JSON) and delegates here. The
 * Supabase client and `fetch` are injected, which is why this module has no
 * `jsr:` import.
 *
 * Actions
 *   status  -> { ok, configured }                     (no Google call)
 *   verify  -> health check: can this token write to this calendar?
 *   create  -> creates the event (and its Meet conference) for a schedule
 *   update  -> patches the existing event
 *   cancel  -> deletes the event, after checking it belongs to the application
 *   sync    -> reconciles Google against the saved record (repair path)
 *
 * The attendee list always comes from the database (the student, each account
 * panelist, and each faculty guest with an email), never from the request body:
 * the panel is saved before this runs, so a tampered body cannot invite anyone.
 * The schedule itself is taken from the body for create/update because the app
 * calls Google before it writes the record; `sync` reads the saved record
 * instead, which is what makes it a repair path.
 *
 * This module never writes `applications`: a sync result is returned to the app,
 * which patches the record through the normal stage write so the student-side
 * rules (and the database triggers) still apply.
 */
import {
  GOOGLE_CODES,
  buildGoogleInterviewEvent,
  cancelGoogleInterviewEvent,
  describeGoogleFailure,
  fetchGoogleAccessToken,
  findGoogleInterviewEvent,
  getMeetRequestId,
  upsertGoogleInterviewEvent,
  verifyGoogleCalendar,
} from './googleCalendar.js';
import { INTERVIEW_DURATIONS, isStructuredInterview } from './interview.js';

export const INTERVIEW_EVENT_ACTIONS = ['status', 'verify', 'create', 'update', 'cancel', 'sync'];

const jsonResult = (body, httpStatus = 200) => ({ httpStatus, body });

const isSafeMeetingUrl = (value) => /^https:\/\/\S+$/i.test(String(value || '').trim());

const readApplication = async (supabase, applicationId) => {
  const { data, error } = await supabase
    .from('applications')
    .select('id, student_id, scholarship_id, status, interview')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) return null;
  return data || null;
};

/**
 * The student, the account panelists (SOP 5a: Department Chairs from the
 * applicant's school), and the typed faculty guests who have an email.
 */
const readAttendees = async (supabase, application) => {
  const [{ data: student }, { data: panelRows }] = await Promise.all([
    supabase.from('profiles').select('full_name, email, department').eq('user_id', application.student_id).maybeSingle(),
    supabase
      .from('application_interview_panelists')
      .select('profile_id, guest_name, guest_email')
      .eq('application_id', application.id)
      .is('removed_at', null),
  ]);
  const accountIds = (panelRows ?? []).map((row) => row.profile_id).filter(Boolean);
  const { data: accountProfiles } = accountIds.length
    ? await supabase.from('profiles').select('user_id, full_name, email').in('user_id', accountIds)
    : { data: [] };
  return {
    student: student || null,
    attendees: [
      { email: student?.email, name: student?.full_name },
      ...(accountProfiles ?? []).map((row) => ({ email: row.email, name: row.full_name })),
      ...(panelRows ?? []).filter((row) => !row.profile_id && row.guest_email).map((row) => ({ email: row.guest_email, name: row.guest_name })),
    ],
  };
};

const readLedger = async (supabase, applicationId) => {
  try {
    const { data } = await supabase
      .from('interview_calendar_events')
      .select('application_id, event_id, html_link, meet_url, revision, sync_state')
      .eq('application_id', applicationId)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
};

// Best effort: the ledger is an operational aid. A project that has not applied
// the migration yet must still be able to schedule an interview.
const writeLedger = async (supabase, row) => {
  try {
    await supabase
      .from('interview_calendar_events')
      .upsert({ ...row, updated_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() }, { onConflict: 'application_id' });
  } catch {
    // Ignore: the calendar write already happened, and the app still gets its answer.
  }
};

const readScholarshipTitle = async (supabase, scholarshipId) => {
  if (!scholarshipId) return '';
  const { data } = await supabase.from('scholarships').select('title').eq('id', scholarshipId).maybeSingle();
  return data?.title || '';
};

const failureResult = ({ result, config, extra = {} }) => jsonResult({
  ok: false,
  configured: true,
  code: result.code || GOOGLE_CODES.ERROR,
  calendarId: config.calendarId,
  reason: describeGoogleFailure({ ...result, calendarId: config.calendarId }),
  ...extra,
});

const verifyAction = async ({ config, fetchImpl }) => {
  const auth = await fetchGoogleAccessToken(config, { fetchImpl });
  if (!auth.ok) {
    return jsonResult({
      ok: false,
      configured: true,
      code: auth.code,
      calendarId: config.calendarId,
      reason: describeGoogleFailure({ code: auth.code, calendarId: config.calendarId, reason: auth.error }),
    });
  }
  const check = await verifyGoogleCalendar({ config, accessToken: auth.accessToken, fetchImpl });
  if (!check.ok) {
    return jsonResult({
      ok: false,
      configured: true,
      code: check.code,
      calendarId: config.calendarId,
      reason: describeGoogleFailure({ code: check.code, calendarId: config.calendarId, reason: check.reason }),
    });
  }
  return jsonResult({ ok: true, configured: true, calendarId: config.calendarId, calendar: check.calendar });
};

/**
 * Deletes the event. A cancellation clears `applications.interview.calendar`, so
 * once the record no longer names the event the provider's own extended
 * properties are checked instead of trusting the id in the request body.
 */
const cancelAction = async ({ config, payload, application, supabase, fetchImpl, resolveToken, authFailure }) => {
  const applicationId = application.id;
  const eventId = String(payload?.eventId ?? '').trim();
  if (!eventId) return jsonResult({ error: 'eventId is required' }, 400);

  const interview = isStructuredInterview(application.interview) ? application.interview : null;
  const revision = Number(interview?.revision) || null;
  const storedEventId = String(interview?.calendar?.eventId || '').trim();
  if (storedEventId && storedEventId !== eventId) {
    return jsonResult({ error: 'That calendar event does not belong to this application' }, 409);
  }

  const auth = await resolveToken();
  if (!auth.ok) return authFailure(auth);
  const { accessToken } = auth;

  if (!storedEventId) {
    const found = await findGoogleInterviewEvent({ config, accessToken, applicationId, fetchImpl });
    if (found.ok && found.event?.id && found.event.id !== eventId) {
      return jsonResult({ error: 'That calendar event does not belong to this application' }, 409);
    }
  }

  const result = await cancelGoogleInterviewEvent({ config, accessToken, eventId, fetchImpl });
  if (!result.ok) {
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: eventId,
      revision,
      sync_state: 'failed',
      last_error: describeGoogleFailure(result),
    });
    return failureResult({ result, config });
  }
  await writeLedger(supabase, {
    application_id: applicationId,
    provider: 'google',
    calendar_id: config.calendarId,
    event_id: eventId,
    revision,
    sync_state: 'cancelled',
    last_error: null,
  });
  return jsonResult({ ok: true, configured: true });
};

/**
 * Reconciles Google against the saved record without touching the application
 * row: whatever the provider reports is returned to the app, which patches the
 * record through its normal stage write. This is the recovery path for a browser
 * that closed between the Google write and the database write, and for a
 * cancellation whose delete failed.
 */
const syncAction = async ({ config, application, supabase, fetchImpl, resolveToken, authFailure }) => {
  const applicationId = application.id;
  const interview = isStructuredInterview(application.interview) ? application.interview : null;
  if (!interview) {
    return jsonResult({
      ok: false,
      configured: true,
      code: 'not_scheduled',
      reason: 'This application has no calendar-backed interview to repair.',
    }, 409);
  }

  const auth = await resolveToken();
  if (!auth.ok) return authFailure(auth);
  const { accessToken } = auth;

  const ledger = await readLedger(supabase, applicationId);
  const revision = Number(interview.revision) || 1;
  const knownEventId = String(interview.calendar?.eventId || ledger?.event_id || '').trim();

  if (interview.state === 'cancelled') {
    if (!knownEventId) return jsonResult({ ok: true, configured: true, repaired: 'unchanged', calendar: null });
    const removed = await cancelGoogleInterviewEvent({ config, accessToken, eventId: knownEventId, fetchImpl });
    if (!removed.ok) {
      await writeLedger(supabase, {
        application_id: applicationId,
        provider: 'google',
        calendar_id: config.calendarId,
        event_id: knownEventId,
        revision,
        sync_state: 'failed',
        last_error: describeGoogleFailure(removed),
      });
      return failureResult({ result: removed, config });
    }
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: knownEventId,
      revision,
      sync_state: 'cancelled',
      last_error: null,
    });
    return jsonResult({ ok: true, configured: true, repaired: 'deleted', calendar: null });
  }

  const { student, attendees } = await readAttendees(supabase, application);
  const scholarshipTitle = await readScholarshipTitle(supabase, application.scholarship_id);
  const event = buildGoogleInterviewEvent({
    schedule: {
      mode: interview.mode,
      startsAt: interview.startsAt,
      durationMinutes: interview.durationMinutes,
      locationLabel: interview.locationLabel,
      meetingUrl: interview.meetingUrl,
      instructions: interview.instructions,
    },
    scholarshipTitle,
    school: student?.department || interview.school || '',
    attendees,
    requestId: getMeetRequestId(applicationId, revision),
    applicationId,
    revision,
  });

  let existingEventId = knownEventId;
  if (!existingEventId) {
    const found = await findGoogleInterviewEvent({ config, accessToken, applicationId, fetchImpl });
    if (found.ok && found.event?.id) existingEventId = found.event.id;
  }
  const saved = await upsertGoogleInterviewEvent({
    config,
    accessToken,
    event,
    eventId: existingEventId || null,
    fetchImpl,
  });
  if (!saved.ok) {
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: existingEventId || null,
      revision,
      sync_state: 'failed',
      last_error: describeGoogleFailure(saved),
    });
    return failureResult({ result: saved, config });
  }
  await writeLedger(supabase, {
    application_id: applicationId,
    provider: 'google',
    calendar_id: config.calendarId,
    event_id: saved.eventId,
    html_link: saved.htmlLink,
    meet_url: saved.meetingUrl,
    revision,
    sync_state: 'synced',
    last_error: null,
  });
  return jsonResult({
    ok: true,
    configured: true,
    repaired: existingEventId ? 'updated' : 'created',
    calendar: { provider: 'google', eventId: saved.eventId, htmlLink: saved.htmlLink },
    meetingUrl: saved.meetingUrl,
  });
};

/**
 * Creates or patches the event for a schedule the Admissions Office just saved.
 * The schedule comes from the body because the app calls Google before it writes
 * the interview record; the guests and the scholarship title are always re-read
 * from the database.
 */
const scheduleAction = async ({ action, config, payload, application, supabase, fetchImpl, resolveToken, authFailure }) => {
  const applicationId = application.id;
  const schedule = payload?.schedule ?? {};
  const mode = schedule.mode === 'online' ? 'online' : (schedule.mode === 'onsite' ? 'onsite' : '');
  const startsAt = new Date(String(schedule.startsAt ?? ''));
  const durationMinutes = Number(schedule.durationMinutes);
  const meetingUrl = String(schedule.meetingUrl ?? '').trim();

  if (!mode || Number.isNaN(startsAt.getTime()) || !INTERVIEW_DURATIONS.includes(durationMinutes)) {
    return jsonResult({ error: 'A valid schedule is required' }, 400);
  }
  if (mode === 'online' && meetingUrl && !isSafeMeetingUrl(meetingUrl)) {
    return jsonResult({ error: 'Enter a full https:// meeting link.' }, 400);
  }
  if (!['Endorsed', 'Interview'].includes(application.status)) {
    return jsonResult({ error: 'This application is not at the interview stage' }, 409);
  }

  const auth = await resolveToken();
  if (!auth.ok) return authFailure(auth);
  const { accessToken } = auth;

  const previous = isStructuredInterview(application.interview) ? application.interview : null;
  const revision = previous ? (Number(previous.revision) || 1) + 1 : 1;
  const { student, attendees } = await readAttendees(supabase, application);
  const scholarshipTitle = await readScholarshipTitle(supabase, application.scholarship_id);

  // `conferenceData: null` does not reliably strip conferencing, so an online ↔
  // on-site change replaces the event: the guests see one cancellation and one
  // new invitation, which is the honest outcome of that change.
  let existingEventId = action === 'update' ? String(payload?.eventId ?? '').trim() : '';
  let recreated = false;
  const previousEventId = String(previous?.calendar?.eventId || '').trim();
  if (previousEventId && previous && previous.mode !== mode) {
    const removed = await cancelGoogleInterviewEvent({ config, accessToken, eventId: previousEventId, fetchImpl });
    if (!removed.ok) {
      await writeLedger(supabase, {
        application_id: applicationId,
        provider: 'google',
        calendar_id: config.calendarId,
        event_id: previousEventId,
        revision: Number(previous?.revision) || null,
        sync_state: 'failed',
        last_error: describeGoogleFailure(removed),
      });
      return failureResult({ result: removed, config });
    }
    existingEventId = '';
    recreated = true;
  }

  // A reschedule keeps the existing meeting link. Without this, a blank field in
  // the form would ask Google for a second conference and the interview would end
  // up with two Meet links, only one of which the app shows.
  const reusedMeetingUrl = mode === 'online' && !meetingUrl && previous?.mode === 'online'
    ? String(previous.meetingUrl || '').trim()
    : '';

  const event = buildGoogleInterviewEvent({
    schedule: {
      mode,
      startsAt: startsAt.toISOString(),
      durationMinutes,
      locationLabel: String(schedule.locationLabel ?? ''),
      meetingUrl: meetingUrl || reusedMeetingUrl,
      instructions: String(schedule.instructions ?? ''),
    },
    scholarshipTitle,
    school: student?.department || '',
    attendees,
    requestId: getMeetRequestId(applicationId, revision),
    applicationId,
    revision,
  });

  const saved = await upsertGoogleInterviewEvent({
    config,
    accessToken,
    event,
    eventId: existingEventId || null,
    fetchImpl,
  });
  if (!saved.ok) {
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: existingEventId || null,
      revision,
      sync_state: 'failed',
      last_error: describeGoogleFailure(saved),
    });
    return failureResult({ result: saved, config });
  }
  await writeLedger(supabase, {
    application_id: applicationId,
    provider: 'google',
    calendar_id: config.calendarId,
    event_id: saved.eventId,
    html_link: saved.htmlLink,
    meet_url: saved.meetingUrl,
    revision,
    sync_state: 'synced',
    last_error: null,
  });
  return jsonResult({
    ok: true,
    configured: true,
    eventId: saved.eventId,
    htmlLink: saved.htmlLink,
    meetingUrl: saved.meetingUrl,
    revision,
    recreated,
  });
};

/**
 * The single entry point for the Edge Function. Returns `{ httpStatus, body }`
 * so the transport layer stays a thin wrapper.
 */
export const handleInterviewEvent = async ({ action, payload = {}, config, supabase, fetchImpl = fetch }) => {
  const requested = String(action ?? '').trim();
  if (requested === 'status') {
    return jsonResult({ ok: true, configured: Boolean(config?.configured) });
  }
  if (!INTERVIEW_EVENT_ACTIONS.includes(requested)) {
    return jsonResult({ error: 'Unsupported action' }, 400);
  }
  if (!config?.configured) {
    return jsonResult({
      ok: false,
      configured: false,
      code: GOOGLE_CODES.NOT_CONFIGURED,
      reason: describeGoogleFailure({ code: GOOGLE_CODES.NOT_CONFIGURED }),
    });
  }
  if (requested === 'verify') {
    return verifyAction({ config, fetchImpl });
  }

  const applicationId = String(payload?.applicationId ?? '').trim();
  if (!applicationId) {
    return jsonResult({ error: 'applicationId is required' }, 400);
  }
  const application = await readApplication(supabase, applicationId);
  if (!application) {
    return jsonResult({ error: 'Application not found' }, 404);
  }

  // Fetched lazily: a request that fails its own validation (an invalid
  // schedule, a foreign event id) never spends a Google token round trip.
  const resolveToken = () => fetchGoogleAccessToken(config, { fetchImpl });
  const authFailure = (auth) => jsonResult({
    ok: false,
    configured: true,
    code: auth.code,
    calendarId: config.calendarId,
    reason: describeGoogleFailure({ code: auth.code, calendarId: config.calendarId, reason: auth.error }),
  });

  if (requested === 'cancel') {
    return cancelAction({ config, payload, application, supabase, fetchImpl, resolveToken, authFailure });
  }
  if (requested === 'sync') {
    return syncAction({ config, application, supabase, fetchImpl, resolveToken, authFailure });
  }
  return scheduleAction({ action: requested, config, payload, application, supabase, fetchImpl, resolveToken, authFailure });
};


