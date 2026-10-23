import { beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_TOKEN_URL, clearGoogleAccessTokenCache, getMeetRequestId } from '../supabase/functions/_shared/googleCalendar.js';
import { handleInterviewEvent } from '../supabase/functions/_shared/interviewEvent.js';

const APP_ID = '7ec43e8c-5602-4814-9869-7fe67becb1a9';
const CALENDAR_ID = 'cf16153744dced4ccfdc73020c36238c4be00da6d897a8a2d8cc5cf8a5afb639@group.calendar.google.com';
const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  calendarId: CALENDAR_ID,
  configured: true,
};

const defaultEvent = {
  id: 'evt-1',
  htmlLink: 'https://www.google.com/calendar/event?eid=1',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

const createFetchStub = (options = {}) => {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body });
    if (String(url).startsWith(GOOGLE_TOKEN_URL)) {
      if (options.tokenFailure) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      }
      return jsonResponse({ access_token: options.token || 'access-1', expires_in: options.expiresIn ?? 3600 });
    }
    if (method === 'DELETE' && options.deleteFailure) {
      return jsonResponse({ error: { message: 'backend error', errors: [{ reason: 'backendError' }] } }, options.deleteFailure);
    }
    if (options.calendarFailure) {
      return jsonResponse(
        { error: { message: options.calendarFailure.message || 'Not Found', errors: [{ reason: 'notFound' }] } },
        options.calendarFailure.status,
      );
    }
    if (method === 'DELETE') return jsonResponse({}, 204);
    if (method === 'POST' || method === 'PATCH') return jsonResponse(options.event || defaultEvent);
    return jsonResponse({
      summary: 'ScholarPath AdDU — Scholarship Interviews',
      timeZone: 'Asia/Manila',
      accessRole: 'owner',
      items: options.items ?? [],
    });
  };
  return { impl, calls };
};

// The access-token exchange is itself a POST, so calendar assertions filter it
// out instead of matching whichever request happened first.
const googleCalls = (fetchStub) => fetchStub.calls.filter((call) => !String(call.url).startsWith(GOOGLE_TOKEN_URL));

const createSupabaseStub = (fixtures = {}) => {
  const writes = [];
  const singleFor = (table) => ({
    applications: fixtures.application ?? null,
    profiles: fixtures.student ?? null,
    scholarships: fixtures.scholarship ?? null,
    interview_calendar_events: fixtures.ledger ?? null,
  }[table] ?? null);
  const listFor = (table) => ({
    application_interview_panelists: fixtures.panelists ?? [],
    profiles: fixtures.accountProfiles ?? [],
  }[table] ?? []);
  const from = (table) => {
    const api = {
      select: () => api,
      eq: () => api,
      is: () => api,
      in: () => api,
      maybeSingle: async () => ({ data: singleFor(table), error: null }),
      upsert: async (row, upsertOptions) => {
        writes.push({ table, row, options: upsertOptions });
        return { error: null };
      },
      then: (resolve, reject) => Promise.resolve({ data: listFor(table), error: null }).then(resolve, reject),
    };
    return api;
  };
  return { from, writes };
};

const application = (overrides = {}) => ({
  id: APP_ID,
  student_id: 'student-1',
  scholarship_id: 'sch-1',
  status: 'Endorsed',
  interview: null,
  ...overrides,
});

const structuredInterview = (overrides = {}) => ({
  version: 2,
  state: 'scheduled',
  revision: 1,
  mode: 'online',
  startsAt: '2026-11-03T01:00:00.000Z',
  durationMinutes: 30,
  locationId: null,
  locationLabel: '',
  meetingUrl: '',
  school: 'College of Computer Studies (CCS)',
  calendar: { provider: 'google', eventId: 'evt-1', htmlLink: 'https://www.google.com/calendar/event?eid=1' },
  instructions: '',
  scheduledBy: 'staff-1',
  scheduledAt: '2026-10-23T00:00:00.000Z',
  history: [],
  ...overrides,
});

const schedule = (overrides = {}) => ({
  mode: 'online',
  startsAt: '2026-11-03T01:00:00.000Z',
  durationMinutes: 30,
  locationLabel: '',
  meetingUrl: '',
  instructions: 'Bring your student ID.',
  ...overrides,
});

beforeEach(() => {
  clearGoogleAccessTokenCache();
});

describe('interview event service — status and verify', () => {
  it('reports configuration without calling Google', async () => {
    const fetchStub = createFetchStub();
    const { httpStatus, body } = await handleInterviewEvent({
      action: 'status',
      config: { ...config, configured: false },
      supabase: createSupabaseStub(),
      fetchImpl: fetchStub.impl,
    });
    expect(httpStatus).toBe(200);
    expect(body).toEqual({ ok: true, configured: false });
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('verifies the calendar through events.list, not calendars.get', async () => {
    const fetchStub = createFetchStub();
    const { body } = await handleInterviewEvent({
      action: 'verify',
      config,
      supabase: createSupabaseStub(),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toEqual({
      ok: true,
      configured: true,
      calendarId: CALENDAR_ID,
      calendar: {
        id: CALENDAR_ID,
        summary: 'ScholarPath AdDU — Scholarship Interviews',
        timeZone: 'Asia/Manila',
        accessRole: 'owner',
      },
    });
    const calendarCall = fetchStub.calls.find((call) => call.url.includes('/events?'));
    expect(calendarCall.url).toContain(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events?maxResults=1`);
    expect(calendarCall.url).not.toContain('calendarList');
  });

  it('names an unreachable calendar instead of echoing "Not Found"', async () => {
    const fetchStub = createFetchStub({ calendarFailure: { status: 404 } });
    const { body } = await handleInterviewEvent({
      action: 'verify',
      config,
      supabase: createSupabaseStub(),
      fetchImpl: fetchStub.impl,
    });
    expect(body.ok).toBe(false);
    expect(body.code).toBe('calendar_not_found');
    expect(body.calendarId).toBe(CALENDAR_ID);
    expect(body.reason).toContain(CALENDAR_ID);
  });

  it('reports an expired refresh token as reauth_required', async () => {
    const fetchStub = createFetchStub({ tokenFailure: true });
    const { body } = await handleInterviewEvent({
      action: 'verify',
      config,
      supabase: createSupabaseStub(),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: false, configured: true, code: 'reauth_required' });
    expect(body.reason).toContain('Re-authorize');
  });

  it('reuses one access token across calls', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub();
    await handleInterviewEvent({ action: 'verify', config, supabase, fetchImpl: fetchStub.impl });
    await handleInterviewEvent({ action: 'verify', config, supabase, fetchImpl: fetchStub.impl });
    expect(fetchStub.calls.filter((call) => call.url === GOOGLE_TOKEN_URL)).toHaveLength(1);
  });
});

describe('interview event service — scheduling', () => {
  const fixtures = () => ({
    application: application(),
    student: { full_name: 'Brendon Justine Belen', email: 'student@example.test', department: 'College of Computer Studies (CCS)' },
    scholarship: { title: 'Grant-in-Aid (GIA)' },
    panelists: [
      { profile_id: 'chair-1', guest_name: null, guest_email: null },
      { profile_id: null, guest_name: 'Faculty Guest', guest_email: 'guest@example.test' },
    ],
    accountProfiles: [{ user_id: 'chair-1', full_name: 'Chair', email: 'Chair@addu.edu.ph' }],
  });

  it('creates the event for the database guests with a deterministic Meet request id', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub(fixtures());
    const { body } = await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule() },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({
      ok: true,
      configured: true,
      eventId: 'evt-1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      revision: 1,
      recreated: false,
    });
    const insert = googleCalls(fetchStub).find((call) => call.method === 'POST');
    const sent = JSON.parse(insert.body);
    expect(sent.conferenceData.createRequest).toEqual({
      requestId: getMeetRequestId(APP_ID, 1),
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    });
    expect(sent.extendedProperties.private.scholarpathApplicationId).toBe(APP_ID);
    expect(sent.guestsCanSeeOtherGuests).toBe(false);
    expect(sent.guestsCanInviteOthers).toBe(false);
    expect(sent.attendees.map((entry) => entry.email)).toEqual(['student@example.test', 'Chair@addu.edu.ph', 'guest@example.test']);
    expect(supabase.writes[0].row).toMatchObject({
      application_id: APP_ID,
      sync_state: 'synced',
      event_id: 'evt-1',
      calendar_id: CALENDAR_ID,
    });
  });

  it('patches the known event on reschedule and keeps its Meet link', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub({
      ...fixtures(),
      application: application({
        status: 'Interview',
        interview: structuredInterview({ meetingUrl: 'https://meet.google.com/abc-defg-hij' }),
      }),
    });
    const { body } = await handleInterviewEvent({
      action: 'update',
      payload: { applicationId: APP_ID, eventId: 'evt-1', schedule: schedule({ startsAt: '2026-11-04T02:00:00.000Z' }) },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: true, revision: 2, recreated: false });
    const patch = googleCalls(fetchStub).find((call) => call.method === 'PATCH');
    expect(patch.url).toContain('/events/evt-1?');
    // The existing conference is preserved instead of asking Google for a second
    // Meet link, so the applicant never sees two.
    expect(JSON.parse(patch.body).conferenceData).toBeUndefined();
    expect(JSON.parse(patch.body).location).toBe('https://meet.google.com/abc-defg-hij');
    expect(fetchStub.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('replaces the event when the interview switches to on-site', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub({
      ...fixtures(),
      application: { ...application(), status: 'Interview', interview: structuredInterview() },
    });
    const { body } = await handleInterviewEvent({
      action: 'update',
      payload: {
        applicationId: APP_ID,
        eventId: 'evt-1',
        schedule: schedule({ mode: 'onsite', locationLabel: 'Ateneo de Davao — Room 204' }),
      },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body.recreated).toBe(true);
    const calendarCalls = googleCalls(fetchStub).map((call) => call.method);
    expect(calendarCalls).toEqual(['DELETE', 'POST']);
    expect(JSON.parse(googleCalls(fetchStub).find((call) => call.method === 'POST').body).conferenceData).toBeUndefined();
  });

  it('rejects an invalid schedule, a wrong stage, and an unconfigured integration', async () => {
    const fetchStub = createFetchStub();
    const badSchedule = await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule({ durationMinutes: 17 }) },
      config,
      supabase: createSupabaseStub(fixtures()),
      fetchImpl: fetchStub.impl,
    });
    expect(badSchedule.httpStatus).toBe(400);

    const wrongStage = await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule() },
      config,
      supabase: createSupabaseStub({ ...fixtures(), application: application({ status: 'Submitted' }) }),
      fetchImpl: fetchStub.impl,
    });
    expect(wrongStage.httpStatus).toBe(409);

    const unconfigured = await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule() },
      config: { ...config, configured: false },
      supabase: createSupabaseStub(fixtures()),
      fetchImpl: fetchStub.impl,
    });
    expect(unconfigured.httpStatus).toBe(200);
    expect(unconfigured.body).toMatchObject({ ok: false, configured: false, code: 'not_configured' });
    expect(fetchStub.calls).toHaveLength(0);
  });
});

describe('interview event service — cancel and repair', () => {
  it('refuses to delete an event that belongs to another application', async () => {
    const fetchStub = createFetchStub();
    const { httpStatus } = await handleInterviewEvent({
      action: 'cancel',
      payload: { applicationId: APP_ID, eventId: 'someone-elses-event' },
      config,
      supabase: createSupabaseStub({
        application: application({ status: 'Interview', interview: structuredInterview() }),
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(httpStatus).toBe(409);
    expect(fetchStub.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('checks the provider before deleting when the record no longer names the event', async () => {
    const fetchStub = createFetchStub({ items: [{ id: 'someone-elses-event' }] });
    const { httpStatus } = await handleInterviewEvent({
      action: 'cancel',
      payload: { applicationId: APP_ID, eventId: 'evt-1' },
      config,
      supabase: createSupabaseStub({
        application: application({ status: 'Interview', interview: structuredInterview({ calendar: null }) }),
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(httpStatus).toBe(409);
    expect(fetchStub.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes the event and records the cancellation in the ledger', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub({
      application: application({ status: 'Interview', interview: structuredInterview() }),
    });
    const { body } = await handleInterviewEvent({
      action: 'cancel',
      payload: { applicationId: APP_ID, eventId: 'evt-1' },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body).toEqual({ ok: true, configured: true });
    expect(fetchStub.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(supabase.writes.at(-1).row).toMatchObject({ event_id: 'evt-1', sync_state: 'cancelled' });
  });

  it('creates the missing event from the saved record during a repair', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub({
      application: application({ status: 'Interview', interview: structuredInterview({ calendar: null }) }),
    });
    const { body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({
      ok: true,
      repaired: 'created',
      calendar: { provider: 'google', eventId: 'evt-1' },
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
    const insert = googleCalls(fetchStub).find((call) => call.method === 'POST');
    // The record is the source of truth for a repair, not the request body.
    expect(JSON.parse(insert.body).start.dateTime).toBe('2026-11-03T01:00:00.000Z');
  });

  it('patches the recorded event during a repair', async () => {
    const fetchStub = createFetchStub();
    const { body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase: createSupabaseStub({
        application: application({ status: 'Interview', interview: structuredInterview() }),
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: true, repaired: 'updated' });
    expect(googleCalls(fetchStub).find((call) => call.method === 'PATCH').url).toContain('/events/evt-1');
  });

  it('deletes a cancelled interview found only in the ledger', async () => {
    const fetchStub = createFetchStub();
    const { body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase: createSupabaseStub({
        application: application({
          status: 'Interview',
          interview: structuredInterview({ state: 'cancelled', calendar: null, revision: 2 }),
        }),
        ledger: { application_id: APP_ID, event_id: 'evt-orphan', sync_state: 'synced' },
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toEqual({ ok: true, configured: true, repaired: 'deleted', calendar: null });
    expect(googleCalls(fetchStub).find((call) => call.method === 'DELETE').url).toContain('/events/evt-orphan');
  });

  it('reports nothing to repair when the application has no interview', async () => {
    const fetchStub = createFetchStub();
    const { httpStatus, body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase: createSupabaseStub({ application: application({ status: 'Endorsed' }) }),
      fetchImpl: fetchStub.impl,
    });
    expect(httpStatus).toBe(409);
    expect(body).toMatchObject({ ok: false, code: 'not_scheduled' });
  });
});



