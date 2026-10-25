/**
 * Minimal Google Calendar client for interview events (SOP step 5).
 *
 * Dependency-free (plain fetch, injectable for tests) like _shared/resend.js and
 * _shared/sms.js. One office Google account consents once to the
 * `https://www.googleapis.com/auth/calendar.events` scope; its refresh token is
 * kept as an Edge Function secret and never reaches the browser.
 *
 * Scope note: `calendar.events` covers creating, patching, and deleting events,
 * including the Google Meet conference. It does NOT cover `calendars.get` or
 * `calendarList.list`, which answer 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT — so the
 * health check reads the target calendar through `events.list` instead, the same
 * permission the runtime actually uses.
 *
 * Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
 * GOOGLE_CALENDAR_REFRESH_TOKEN, and GOOGLE_CALENDAR_ID (default `primary`).
 * With any of the first three missing the integration reports
 * `configured: false` and the app falls back to a pasted meeting link.
 *
 * Google OAuth note: while the OAuth consent screen is in "Testing" status,
 * refresh tokens expire after 7 days. Re-run `npm run google:auth` (scripts/
 * google-calendar-auth.mjs) and update GOOGLE_CALENDAR_REFRESH_TOKEN. Publishing
 * the app or consenting with an internal Google Workspace app removes the limit.
 */
import { INTERVIEW_TIME_ZONE, getInterviewEndsAt } from './interview.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Stable codes, so the staff UI can explain a failure instead of echoing a raw
// Google message ("Not Found" tells nobody which half of the setup is wrong).
export const GOOGLE_CODES = {
  NOT_CONFIGURED: 'not_configured',
  REAUTH_REQUIRED: 'reauth_required',
  CALENDAR_NOT_FOUND: 'calendar_not_found',
  CALENDAR_FORBIDDEN: 'calendar_forbidden',
  EVENT_NOT_FOUND: 'event_not_found',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  UNAVAILABLE: 'google_unavailable',
  UNREACHABLE: 'google_unreachable',
  ERROR: 'google_error',
};

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
const RETRY_MAX_WAIT_MS = 4000;
const TOKEN_SKEW_MS = 60_000;
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

/**
 * The deterministic Meet conference request id. Google dedupes conference
 * creation on it, so a retried create cannot fork a second Meet link for the
 * same interview revision.
 */
export const getMeetRequestId = (applicationId, revision) =>
  `scholarpath-${String(applicationId || 'interview')}-r${Number(revision) || 1}`;

export const getGoogleCalendarConfig = (env = {}) => {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_CALENDAR_REFRESH_TOKEN || '').trim();
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: String(env.GOOGLE_CALENDAR_ID || '').trim() || 'primary',
    configured: Boolean(clientId && clientSecret && refreshToken),
  };
};

const readErrorDetail = async (response) => {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const message = body?.error?.message
    || body?.error_description
    || (typeof body?.error === 'string' ? body.error : '')
    || `Google responded with ${response.status}`;
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  return { message, reason };
};

const codeForStatus = (status, detail = {}) => {
  const haystack = `${detail.reason || ''} ${detail.message || ''}`;
  if (status === 401) return GOOGLE_CODES.REAUTH_REQUIRED;
  if (status === 403) return /insufficient/i.test(haystack) ? GOOGLE_CODES.INSUFFICIENT_SCOPE : GOOGLE_CODES.CALENDAR_FORBIDDEN;
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status === 429 || status >= 500) return GOOGLE_CODES.UNAVAILABLE;
  return GOOGLE_CODES.ERROR;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryWaitMs = (response, attempt) => {
  const header = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, RETRY_MAX_WAIT_MS);
  return RETRY_BASE_MS * attempt;
};

/**
 * One retrying fetch. `retryStatuses` is per call because the verbs differ: a
 * PATCH or DELETE can be repeated safely, but a POST that returns 5xx may have
 * already created the event, so only a 429 (definitely rejected) is retried.
 */
const requestGoogle = async ({ url, init, fetchImpl = fetch, retryStatuses = RETRYABLE_STATUSES, sleepImpl = sleep }) => {
  let failure = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      failure = { status: 0, code: GOOGLE_CODES.UNREACHABLE, error: error?.message || 'Unable to reach Google' };
      if (attempt < MAX_ATTEMPTS) {
        await sleepImpl(RETRY_BASE_MS * attempt);
        continue;
      }
      return { ok: false, ...failure };
    }
    if (response.ok) return { ok: true, status: response.status, response };
    const detail = await readErrorDetail(response);
    failure = { status: response.status, code: codeForStatus(response.status, detail), error: detail.message };
    if (attempt < MAX_ATTEMPTS && retryStatuses.includes(response.status)) {
      await sleepImpl(retryWaitMs(response, attempt));
      continue;
    }
    return { ok: false, ...failure };
  }
  return { ok: false, ...(failure || { code: GOOGLE_CODES.ERROR, error: 'Google request failed' }) };
};

// One access token per client/refresh-token pair, reused until it is within a
// minute of expiry, so a schedule that creates, patches, and re-reads an event
// costs one token call instead of three.
const accessTokenCache = new Map();

export const clearGoogleAccessTokenCache = () => {
  accessTokenCache.clear();
};

export const fetchGoogleAccessToken = async (config, { fetchImpl = fetch, now = Date.now, force = false } = {}) => {
  if (!config?.configured) {
    return { ok: false, code: GOOGLE_CODES.NOT_CONFIGURED, error: 'Google Calendar is not configured' };
  }
  const key = `${config.clientId}\u0000${config.refreshToken}`;
  const stamp = Number(typeof now === 'function' ? now() : now) || 0;
  const cached = accessTokenCache.get(key);
  if (!force && cached && cached.expiresAt > stamp) {
    return { ok: true, accessToken: cached.accessToken, cached: true };
  }
  const result = await requestGoogle({
    url: GOOGLE_TOKEN_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    },
    fetchImpl,
    retryStatuses: [429],
  });
  if (!result.ok) {
    const code = result.status === 400 || result.status === 401 ? GOOGLE_CODES.REAUTH_REQUIRED : result.code;
    return { ok: false, code, error: `Google rejected the stored authorization (${result.error})` };
  }
  let body = null;
  try {
    body = await result.response.json();
  } catch {
    body = null;
  }
  if (!body?.access_token) {
    return { ok: false, code: GOOGLE_CODES.ERROR, error: 'Google returned no access token' };
  }
  const expiresIn = Number(body.expires_in) || 3600;
  accessTokenCache.set(key, {
    accessToken: body.access_token,
    expiresAt: stamp + Math.max(0, expiresIn * 1000 - TOKEN_SKEW_MS),
  });
  return { ok: true, accessToken: body.access_token, expiresIn, cached: false };
};

/**
 * Guests are deduped case-insensitively: `Chair@addu.edu.ph` and
 * `chair@addu.edu.ph` are one attendee, and Google refuses an event whose guest
 * list repeats an address.
 */
const dedupeAttendees = (attendees = []) => {
  const seen = new Set();
  const list = [];
  attendees.forEach((entry) => {
    const email = String(entry?.email || '').trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const name = String(entry?.name || '').trim();
    list.push(name ? { email, displayName: name } : { email });
  });
  return list;
};

/**
 * The Calendar event for an interview. The guest list is hidden from guests
 * (`guestsCanSeeOtherGuests: false`) so the applicant never sees the panel
 * members' names or emails through the invitation, matching the app. The private
 * extended properties let the function find its own event again if the stored id
 * is ever lost.
 */
export const buildGoogleInterviewEvent = ({ schedule, scholarshipTitle = '', school = '', attendees = [], requestId = '', applicationId = '', revision = 1 }) => {
  const isOnline = schedule.mode === 'online';
  const manualLink = isOnline ? String(schedule.meetingUrl || '').trim() : '';
  const description = [
    `ScholarPath AdDU scholarship interview${scholarshipTitle ? ` for ${scholarshipTitle}` : ''}.`,
    school ? `Interview panel from ${school}.` : '',
    manualLink ? `Join: ${manualLink}` : '',
    String(schedule.instructions || '').trim(),
  ].filter(Boolean).join('\n');
  const event = {
    summary: `Scholarship interview${scholarshipTitle ? ` · ${scholarshipTitle}` : ''}`,
    description,
    location: isOnline ? (manualLink || 'Online') : (schedule.locationLabel || ''),
    start: { dateTime: new Date(schedule.startsAt).toISOString(), timeZone: INTERVIEW_TIME_ZONE },
    end: { dateTime: getInterviewEndsAt(schedule).toISOString(), timeZone: INTERVIEW_TIME_ZONE },
    attendees: dedupeAttendees(attendees),
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
  };
  if (isOnline && !manualLink && requestId) {
    event.conferenceData = { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  if (applicationId) {
    event.extendedProperties = {
      private: {
        scholarpathKind: 'interview',
        scholarpathApplicationId: String(applicationId),
        scholarpathRevision: String(Number(revision) || 1),
      },
    };
  }
  return event;
};

export const extractMeetLink = (event) => {
  if (!event) return '';
  if (event.hangoutLink) return event.hangoutLink;
  const video = (event.conferenceData?.entryPoints || []).find((entry) => entry.entryPointType === 'video');
  return video?.uri || '';
};

const eventsUrl = (config, path = '', params = {}) => {
  const query = new URLSearchParams(params).toString();
  return `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(config.calendarId)}/events${path}${query ? `?${query}` : ''}`;
};

/**
 * Creates (no eventId) or updates (eventId) the interview event and sends the
 * invitation update to every attendee. Returns
 * `{ ok, eventId, htmlLink, meetingUrl }` or `{ ok: false, code, error }`.
 */
export const upsertGoogleInterviewEvent = async ({ config, accessToken, event, eventId = null, fetchImpl = fetch }) => {
  const params = { conferenceDataVersion: '1', sendUpdates: 'all' };
  const result = await requestGoogle({
    url: eventId ? eventsUrl(config, `/${encodeURIComponent(eventId)}`, params) : eventsUrl(config, '', params),
    init: {
      method: eventId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
    fetchImpl,
    // A create is not idempotent — a 5xx may have created the event — so only a
    // rate-limit rejection is retried.
    retryStatuses: eventId ? RETRYABLE_STATUSES : [429],
  });
  if (!result.ok) {
    return { ok: false, code: result.status === 404 ? GOOGLE_CODES.EVENT_NOT_FOUND : result.code, error: result.error };
  }
  let saved = null;
  try {
    saved = await result.response.json();
  } catch {
    saved = null;
  }
  if (!saved?.id) {
    return { ok: false, code: GOOGLE_CODES.ERROR, error: 'Google returned no event' };
  }
  // Meet creation is usually immediate; when Google reports it as pending, read
  // the event once more for the link.
  if (!extractMeetLink(saved) && saved?.conferenceData?.createRequest?.status?.statusCode === 'pending') {
    const again = await requestGoogle({
      url: eventsUrl(config, `/${encodeURIComponent(saved.id)}`),
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
      fetchImpl,
    });
    if (again.ok) {
      try {
        saved = await again.response.json();
      } catch {
        // Keep the first response; the link simply is not available yet.
      }
    }
  }
  return { ok: true, eventId: saved.id, htmlLink: saved.htmlLink || '', meetingUrl: extractMeetLink(saved) };
};

/**
 * Attaches a Meet conference to an event that has none.
 *
 * A schedule created from a reused or pasted link carries that link in its
 * `location` but no `conferenceData`, so `extractMeetLink` has nothing to read and
 * the interview record ends up with no link of its own. This is the repair that
 * gives such an event a real conference. `conferenceDataVersion: 1` is required
 * for any conference write, a PATCH merges the field into the existing event, and
 * the deterministic request id makes a retry idempotent.
 */
export const ensureGoogleMeetConference = async ({ config, accessToken, eventId, requestId, fetchImpl = fetch }) => {
  if (!eventId || !requestId) {
    return { ok: false, code: GOOGLE_CODES.ERROR, error: 'An event id and a request id are required.' };
  }
  const saved = await upsertGoogleInterviewEvent({
    config,
    accessToken,
    eventId,
    fetchImpl,
    event: { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } },
  });
  if (!saved.ok) return saved;
  return { ok: true, eventId: saved.eventId, htmlLink: saved.htmlLink, meetingUrl: saved.meetingUrl };
};

/**
 * Deletes the interview event. An event that is already gone (404/410) counts as
 * cancelled, so retrying a delete is safe.
 */
export const cancelGoogleInterviewEvent = async ({ config, accessToken, eventId, fetchImpl = fetch }) => {
  const result = await requestGoogle({
    url: eventsUrl(config, `/${encodeURIComponent(eventId)}`, { sendUpdates: 'all' }),
    init: { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  });
  if (result.ok || result.status === 404 || result.status === 410) return { ok: true };
  return { ok: false, code: result.code, error: result.error };
};

/** Reads one event, used to confirm an event belongs to the application. */
export const getGoogleInterviewEvent = async ({ config, accessToken, eventId, fetchImpl = fetch }) => {
  const result = await requestGoogle({
    url: eventsUrl(config, `/${encodeURIComponent(eventId)}`),
    init: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, code: result.status === 404 ? GOOGLE_CODES.EVENT_NOT_FOUND : result.code, error: result.error };
  }
  let event = null;
  try {
    event = await result.response.json();
  } catch {
    event = null;
  }
  return { ok: true, event };
};

/**
 * Every event this application owns, found through the private extended
 * properties written by buildGoogleInterviewEvent. Returning all of them (not
 * just the first) is what lets a repair sweep a duplicate instead of adopting one
 * match and leaving the other live.
 */
export const findGoogleInterviewEvents = async ({ config, accessToken, applicationId, fetchImpl = fetch }) => {
  const result = await requestGoogle({
    url: eventsUrl(config, '', {
      privateExtendedProperty: `scholarpathApplicationId=${applicationId}`,
      maxResults: '20',
    }),
    init: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.status === 404 ? GOOGLE_CODES.CALENDAR_NOT_FOUND : result.code,
      error: result.error,
    };
  }
  let body = null;
  try {
    body = await result.response.json();
  } catch {
    body = null;
  }
  const events = Array.isArray(body?.items)
    ? body.items.filter((item) => item?.status !== 'cancelled' && item?.id)
    : [];
  return { ok: true, events };
};

/**
 * The first event this application owns. Kept for the callers that only need to
 * answer "does this application already have an event?".
 */
export const findGoogleInterviewEvent = async (params) => {
  const found = await findGoogleInterviewEvents(params);
  if (!found.ok) return found;
  return { ok: true, event: found.events[0] || null };
};

/**
 * The integration health check the staff UI calls. It lists one event on the
 * target calendar rather than reading the calendar resource, because a
 * `calendar.events`-only token is refused by `calendars.get`/`calendarList`
 * (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT) even when the setup is perfect. The
 * `events.list` reply carries the calendar summary, time zone, and the connected
 * account's access role, so one call answers "can this account write here?".
 */
export const verifyGoogleCalendar = async ({ config, accessToken, fetchImpl = fetch }) => {
  const result = await requestGoogle({
    url: eventsUrl(config, '', { maxResults: '1' }),
    init: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
  });
  if (!result.ok) {
    let code = result.code;
    if (result.status === 404) code = GOOGLE_CODES.CALENDAR_NOT_FOUND;
    else if (result.status === 403) code = result.code === GOOGLE_CODES.INSUFFICIENT_SCOPE ? GOOGLE_CODES.INSUFFICIENT_SCOPE : GOOGLE_CODES.CALENDAR_FORBIDDEN;
    return { ok: false, code, reason: result.error };
  }
  let body = null;
  try {
    body = await result.response.json();
  } catch {
    body = null;
  }
  return {
    ok: true,
    calendar: {
      id: config.calendarId,
      summary: body?.summary || '',
      timeZone: body?.timeZone || '',
      accessRole: body?.accessRole || '',
    },
  };
};

/**
 * One sentence for a failure, so the schedule form and the Admissions Office
 * status card can explain what to fix instead of echoing Google's wording.
 */
export const describeGoogleFailure = (result = {}) => {
  switch (result.code) {
    case GOOGLE_CODES.NOT_CONFIGURED:
      return 'The Google Calendar integration is not configured, so a meeting link must be pasted.';
    case GOOGLE_CODES.REAUTH_REQUIRED:
      return 'Google Calendar authorization expired. Re-authorize the office account, or paste a meeting link.';
    case GOOGLE_CODES.CALENDAR_NOT_FOUND:
      return `Google could not find the interview calendar (${result.calendarId || 'GOOGLE_CALENDAR_ID'}) for the connected account. Check the calendar ID, or share the calendar with that account.`;
    case GOOGLE_CODES.CALENDAR_FORBIDDEN:
      return 'The connected Google account cannot add events to the interview calendar.';
    case GOOGLE_CODES.INSUFFICIENT_SCOPE:
      return 'The Google authorization is missing the calendar.events scope. Re-authorize the office account.';
    case GOOGLE_CODES.EVENT_NOT_FOUND:
      return 'The Google Calendar event no longer exists, so a new one will be created.';
    case GOOGLE_CODES.UNAVAILABLE:
      return 'Google Calendar is unavailable right now. Try again, or paste a meeting link.';
    case GOOGLE_CODES.UNREACHABLE:
      return 'Google Calendar could not be reached. Try again, or paste a meeting link.';
    default:
      return result.reason || result.error || 'Google Calendar rejected the request.';
  }
};
