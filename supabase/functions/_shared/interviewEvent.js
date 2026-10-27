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
  ensureGoogleMeetConference,
  fetchGoogleAccessToken,
  findGoogleInterviewEvents,
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

// The ledger keeps one row per provider event. `is_current` marks the event the
// interview record points at; a superseded or failed event keeps its row, so the
// repair action can still find and remove it. A project that has not applied
// 20261031000000 simply has no is_current column, which is why every call below
// is best effort.
const readLiveLedger = async (supabase, applicationId) => {
  try {
    const { data } = await supabase
      .from('interview_calendar_events')
      .select('ledger_id, event_id, html_link, meet_url, revision, sync_state, is_current')
      .eq('application_id', applicationId)
      .eq('is_current', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
};

const retireLedgerEvents = async (supabase, applicationId) => {
  try {
    await supabase
      .from('interview_calendar_events')
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq('application_id', applicationId)
      .eq('is_current', true);
  } catch {
    // Best effort.
  }
};

// Best effort: the ledger is an operational aid. Writes append a row and never
// overwrite the event they replace, which is what keeps an orphan discoverable.
const writeLedger = async (supabase, row) => {
  try {
    if (row.is_current) await retireLedgerEvents(supabase, row.application_id);
    await supabase
      .from('interview_calendar_events')
      .insert({ ...row, updated_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() });
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
 * Deletes the events an application owns.
 *
 * A cancellation used to clear `applications.interview.calendar` *before* the
 * delete ran and never checked the result, so a failed call left a live event
 * with an invitation and a Meet link that nothing could find again — and the next
 * schedule created a second one. Every id this cancellation can attribute to the
 * application is therefore deleted: the one in the request, the one in the
 * record, the live ledger row, and anything still carrying the application's
 * extended properties (which also sweeps a duplicate).
 */
const cancelAction = async ({ config, payload, application, supabase, fetchImpl, resolveToken, authFailure }) => {
  const applicationId = application.id;
  const requestedEventId = String(payload?.eventId ?? '').trim();
  const interview = isStructuredInterview(application.interview) ? application.interview : null;
  const revision = Number(interview?.revision) || null;
  const storedEventId = String(interview?.calendar?.eventId || '').trim();
  const liveLedger = await readLiveLedger(supabase, applicationId);
  const ledgerEventId = String(liveLedger?.event_id || '').trim();

  if (requestedEventId && storedEventId && storedEventId !== requestedEventId) {
    return jsonResult({ error: 'That calendar event does not belong to this application' }, 409);
  }

  const auth = await resolveToken();
  if (!auth.ok) return authFailure(auth);
  const { accessToken } = auth;

  const found = await findGoogleInterviewEvents({ config, accessToken, applicationId, fetchImpl });
  const attributed = new Set(found.ok ? found.events.map((event) => event.id).filter(Boolean) : []);
  if (
    requestedEventId
    && !attributed.has(requestedEventId)
    && requestedEventId !== storedEventId
    && requestedEventId !== ledgerEventId
  ) {
    return jsonResult({ error: 'That calendar event does not belong to this application' }, 409);
  }

  const targets = new Set([...attributed, requestedEventId, storedEventId, ledgerEventId].filter(Boolean));
  if (!targets.size) {
    await retireLedgerEvents(supabase, applicationId);
    return jsonResult({ ok: true, configured: true, removed: 0 });
  }

  const failed = [];
  for (const target of targets) {
    const result = await cancelGoogleInterviewEvent({ config, accessToken, eventId: target, fetchImpl });
    if (result.ok) {
      await writeLedger(supabase, {
        application_id: applicationId,
        provider: 'google',
        calendar_id: config.calendarId,
        event_id: target,
        revision,
        sync_state: 'cancelled',
        is_current: false,
        last_error: null,
      });
    } else {
      failed.push(target);
      await writeLedger(supabase, {
        application_id: applicationId,
        provider: 'google',
        calendar_id: config.calendarId,
        event_id: target,
        revision,
        sync_state: 'failed',
        is_current: false,
        last_error: describeGoogleFailure(result),
      });
    }
  }
  // Nothing points at a live event any more, whether or not every delete landed.
  await retireLedgerEvents(supabase, applicationId);
  if (failed.length) {
    return failureResult({
      result: { code: GOOGLE_CODES.ERROR, error: 'One or more calendar events could not be removed.' },
      config,
      extra: { removed: targets.size - failed.length, failed },
    });
  }
  return jsonResult({ ok: true, configured: true, removed: targets.size });
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

  const liveLedger = await readLiveLedger(supabase, applicationId);
  const revision = Number(interview.revision) || 1;
  const knownEventId = String(interview.calendar?.eventId || liveLedger?.event_id || '').trim();

  // Every event that names this application, so a repair can sweep a duplicate
  // instead of keeping the first match and leaving the other one live.
  const foundBefore = await findGoogleInterviewEvents({ config, accessToken, applicationId, fetchImpl });
  const tracked = foundBefore.ok ? foundBefore.events : [];

  if (interview.state === 'cancelled') {
    const targets = new Set([...tracked.map((event) => event.id).filter(Boolean), knownEventId].filter(Boolean));
    const failed = [];
    for (const target of targets) {
      const removed = await cancelGoogleInterviewEvent({ config, accessToken, eventId: target, fetchImpl });
      await writeLedger(supabase, {
        application_id: applicationId,
        provider: 'google',
        calendar_id: config.calendarId,
        event_id: target,
        revision,
        sync_state: removed.ok ? 'cancelled' : 'failed',
        is_current: false,
        last_error: removed.ok ? null : describeGoogleFailure(removed),
      });
      if (!removed.ok) failed.push(target);
    }
    await retireLedgerEvents(supabase, applicationId);
    if (failed.length) {
      return failureResult({
        result: { code: GOOGLE_CODES.ERROR, error: 'The cancelled interview still has a calendar event that could not be removed.' },
        config,
        extra: { failed },
      });
    }
    return jsonResult({
      ok: true,
      configured: true,
      repaired: targets.size ? 'deleted' : 'unchanged',
      removed: targets.size,
      calendar: null,
    });
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

  let existingEventId = knownEventId || String(tracked[0]?.id || '').trim();
  let saved = await upsertGoogleInterviewEvent({
    config,
    accessToken,
    event,
    eventId: existingEventId || null,
    fetchImpl,
  });
  // The record or the ledger can name an event that no longer exists. Recreate it
  // instead of reporting a repair that cannot happen.
  if (!saved.ok && saved.code === GOOGLE_CODES.EVENT_NOT_FOUND) {
    existingEventId = '';
    saved = await upsertGoogleInterviewEvent({ config, accessToken, event, eventId: null, fetchImpl });
  }
  if (!saved.ok) {
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: existingEventId || null,
      revision,
      sync_state: 'failed',
      is_current: false,
      last_error: describeGoogleFailure(saved),
    });
    return failureResult({ result: saved, config });
  }

  // Sweep any other event this application owns: that is what removes a duplicate
  // left behind by an earlier cancel whose delete never landed.
  const extraEvents = tracked.filter((entry) => entry.id && entry.id !== saved.eventId);
  let removed = 0;
  for (const entry of extraEvents) {
    const swept = await cancelGoogleInterviewEvent({ config, accessToken, eventId: entry.id, fetchImpl });
    if (swept.ok) {
      removed += 1;
      continue;
    }
    await writeLedger(supabase, {
      application_id: applicationId,
      provider: 'google',
      calendar_id: config.calendarId,
      event_id: entry.id,
      revision,
      sync_state: 'failed',
      is_current: false,
      last_error: describeGoogleFailure(swept),
    });
  }

  // An event created from a reused or pasted link carries that link in `location`
  // but owns no conference, so `extractMeetLink` finds nothing and the record can
  // end up with no meeting link at all. Give such an event a real one, but never
  // override a link the office pasted itself.
  let meetingUrl = saved.meetingUrl
    || (interview.mode === 'online' ? String(interview.meetingUrl || '').trim() : '');
  let repaired = existingEventId ? 'updated' : 'created';
  if (interview.mode === 'online' && !meetingUrl) {
    const conference = await ensureGoogleMeetConference({
      config,
      accessToken,
      eventId: saved.eventId,
      requestId: getMeetRequestId(applicationId, revision),
      fetchImpl,
    });
    if (conference.ok && conference.meetingUrl) {
      meetingUrl = conference.meetingUrl;
      repaired = 'relinked';
    }
  }

  await writeLedger(supabase, {
    application_id: applicationId,
    provider: 'google',
    calendar_id: config.calendarId,
    event_id: saved.eventId,
    html_link: saved.htmlLink,
    meet_url: meetingUrl,
    revision,
    sync_state: 'synced',
    is_current: true,
    last_error: null,
  });
  return jsonResult({
    ok: true,
    configured: true,
    repaired,
    removed,
    calendar: { provider: 'google', eventId: saved.eventId, htmlLink: saved.htmlLink },
    meetingUrl,
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
  // A create adopts whatever event this application already owns — the live
  // ledger row, or an event carrying its private extended properties — instead of
  // adding a second one. That is what a cancelled-then-rescheduled interview
  // needs, because the record no longer names the event a failed cancel left live.
  if (!existingEventId) {
    const liveLedger = await readLiveLedger(supabase, applicationId);
    existingEventId = String(liveLedger?.event_id || '').trim();
  }
  if (!existingEventId) {
    const found = await findGoogleInterviewEvents({ config, accessToken, applicationId, fetchImpl });
    if (found.ok) existingEventId = String(found.events[0]?.id || '').trim();
  }
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

  // A reschedule keeps the existing meeting link, so a blank field does not ask
  // Google for a second conference. A cancelled interview's link belongs to an
  // event that was deleted (or should have been), so it is never reused.
  const reusablePrevious = Boolean(previous) && previous.mode === 'online' && previous.state !== 'cancelled';
  const reusedMeetingUrl = mode === 'online' && !meetingUrl && reusablePrevious
    ? String(previous.meetingUrl || '').trim()
    : '';

  const effectiveLink = meetingUrl || reusedMeetingUrl;

  const event = buildGoogleInterviewEvent({
    schedule: {
      mode,
      startsAt: startsAt.toISOString(),
      durationMinutes,
      locationLabel: String(schedule.locationLabel ?? ''),
      meetingUrl: effectiveLink,
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
      is_current: false,
      last_error: describeGoogleFailure(saved),
    });
    return failureResult({ result: saved, config });
  }
  // The effective link is what the app stores. Google returns a Meet link only
  // when it created the conference; a reused or pasted link lives in the event's
  // location, so without this fallback the record would hold no link at all while
  // the calendar showed one.
  const effectiveMeetingUrl = saved.meetingUrl || (mode === 'online' ? effectiveLink : '');
  await writeLedger(supabase, {
    application_id: applicationId,
    provider: 'google',
    calendar_id: config.calendarId,
    event_id: saved.eventId,
    html_link: saved.htmlLink,
    meet_url: effectiveMeetingUrl,
    revision,
    sync_state: 'synced',
    is_current: true,
    last_error: null,
  });
  return jsonResult({
    ok: true,
    configured: true,
    eventId: saved.eventId,
    htmlLink: saved.htmlLink,
    meetingUrl: effectiveMeetingUrl,
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


