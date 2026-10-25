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
  let writeIndex = 0;
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
    if (method === 'POST' || method === 'PATCH') {
      // `eventSequence` answers successive writes with different bodies, which is
      // how a repair that has to attach a conference is exercised.
      const sequence = Array.isArray(options.eventSequence) ? options.eventSequence : [];
      const next = sequence.length ? sequence[Math.min(writeIndex, sequence.length - 1)] : null;
      writeIndex += 1;
      return jsonResponse(next || options.event || defaultEvent);
    }
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
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: singleFor(table), error: null }),
      insert: async (row) => {
        writes.push({ table, kind: 'insert', row });
        return { error: null };
      },
      update: async (row) => {
        writes.push({ table, kind: 'update', row });
        return { error: null };
      },
      upsert: async (row, upsertOptions) => {
        writes.push({ table, kind: 'upsert', row, options: upsertOptions });
        return { error: null };
      },
      then: (resolve, reject) => Promise.resolve({ data: listFor(table), error: null }).then(resolve, reject),
    };
    return api;
  };
  return { from, writes };
};

// The synced row is appended after the ledger retires the row it replaces, so the
// assertion has to pick it out rather than assume writes[0].
const syncedWrite = (supabase, state = 'synced') => supabase.writes
  .filter((write) => write.kind === 'insert' && write.row.sync_state === state)
  .at(-1);

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
    expect(syncedWrite(supabase).row).toMatchObject({
      application_id: APP_ID,
      sync_state: 'synced',
      event_id: 'evt-1',
      calendar_id: CALENDAR_ID,
      is_current: true,
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
    expect(body).toMatchObject({ ok: true, configured: true, removed: 1 });
    expect(fetchStub.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(supabase.writes.filter((write) => write.kind === 'insert').at(-1).row)
      .toMatchObject({ event_id: 'evt-1', sync_state: 'cancelled', is_current: false });
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
    expect(body).toMatchObject({ ok: true, configured: true, repaired: 'deleted', removed: 1, calendar: null });
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

// One interview, one Google event. A cancel that could not reach Google used to
// leave the event live while the record forgot its id, so the next schedule
// created a second event at the same time.
describe('interview event service — one event per interview', () => {
  const fixtures = () => ({
    student: { full_name: 'Brendon Justine Belen', email: 'student@example.test', department: 'College of Computer Studies (CCS)' },
    scholarship: { title: 'Grant-in-Aid (GIA)' },
    panelists: [{ profile_id: 'chair-1', guest_name: null, guest_email: null }],
    accountProfiles: [{ user_id: 'chair-1', full_name: 'Chair', email: 'chair@addu.edu.ph' }],
  });

  it('adopts the live ledger event instead of creating a second one', async () => {
    const fetchStub = createFetchStub();
    const supabase = createSupabaseStub({
      ...fixtures(),
      application: application(),
      ledger: { event_id: 'evt-old', is_current: true, sync_state: 'synced' },
    });
    const { body } = await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule() },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: true, configured: true });
    const writes = googleCalls(fetchStub).filter((call) => call.method === 'POST' || call.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PATCH');
    expect(writes[0].url).toContain('/events/evt-old');
  });

  it('keeps the reused meeting link when Google returns no conference', async () => {
    const fetchStub = createFetchStub({ event: { id: 'evt-1', htmlLink: 'https://www.google.com/calendar/event?eid=1' } });
    const supabase = createSupabaseStub({
      ...fixtures(),
      application: application({
        status: 'Interview',
        interview: structuredInterview({ meetingUrl: 'https://meet.google.com/old-link' }),
      }),
    });
    const { body } = await handleInterviewEvent({
      action: 'update',
      payload: { applicationId: APP_ID, eventId: 'evt-1', schedule: schedule({ meetingUrl: '' }) },
      config,
      supabase,
      fetchImpl: fetchStub.impl,
    });
    expect(body.meetingUrl).toBe('https://meet.google.com/old-link');
    const sent = JSON.parse(googleCalls(fetchStub).find((call) => call.method === 'PATCH').body);
    expect(sent.conferenceData).toBeUndefined();
    expect(sent.location).toBe('https://meet.google.com/old-link');
    expect(syncedWrite(supabase).row.meet_url).toBe('https://meet.google.com/old-link');
  });

  it('never reuses the meeting link of a cancelled interview', async () => {
    const fetchStub = createFetchStub();
    await handleInterviewEvent({
      action: 'create',
      payload: { applicationId: APP_ID, schedule: schedule() },
      config,
      supabase: createSupabaseStub({
        ...fixtures(),
        application: application({
          status: 'Endorsed',
          interview: structuredInterview({
            state: 'cancelled',
            meetingUrl: 'https://meet.google.com/dead',
            calendar: null,
            revision: 2,
          }),
        }),
      }),
      fetchImpl: fetchStub.impl,
    });
    const sent = JSON.parse(googleCalls(fetchStub).find((call) => call.method === 'POST').body);
    expect(sent.conferenceData.createRequest.requestId).toBe(getMeetRequestId(APP_ID, 3));
  });

  it('deletes a duplicate event during a repair', async () => {
    const fetchStub = createFetchStub({
      items: [{ id: 'evt-1' }, { id: 'evt-2' }],
      event: { id: 'evt-1', htmlLink: 'x', hangoutLink: 'https://meet.google.com/abc-defg-hij' },
    });
    const { body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase: createSupabaseStub({
        application: application({ status: 'Interview', interview: structuredInterview() }),
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: true, repaired: 'updated', removed: 1 });
    const deletes = googleCalls(fetchStub).filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain('/events/evt-2');
  });

  it('attaches a conference to an event that has no link', async () => {
    const fetchStub = createFetchStub({
      eventSequence: [
        { id: 'evt-1', htmlLink: 'x' },
        { id: 'evt-1', htmlLink: 'x', hangoutLink: 'https://meet.google.com/new-link' },
      ],
    });
    const { body } = await handleInterviewEvent({
      action: 'sync',
      payload: { applicationId: APP_ID },
      config,
      supabase: createSupabaseStub({
        application: application({ status: 'Interview', interview: structuredInterview({ meetingUrl: '' }) }),
      }),
      fetchImpl: fetchStub.impl,
    });
    expect(body).toMatchObject({ ok: true, repaired: 'relinked', meetingUrl: 'https://meet.google.com/new-link' });
    const patches = googleCalls(fetchStub).filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[1].body).conferenceData.createRequest.conferenceSolutionKey)
      .toEqual({ type: 'hangoutsMeet' });
  });

  it('reports a failed removal instead of pretending the event is gone', async () => {
    const fetchStub = createFetchStub({ deleteFailure: 500 });
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
    expect(body).toMatchObject({ ok: false, configured: true });
    expect(supabase.writes.some((write) => write.kind === 'insert' && write.row.sync_state === 'failed')).toBe(true);
  });
});



