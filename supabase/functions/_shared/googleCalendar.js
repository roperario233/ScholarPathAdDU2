/**
 * Minimal Google Calendar client for interview events (SOP step 5).
 *
 * Dependency-free (plain fetch, injectable for tests) like _shared/resend.js and
 * _shared/sms.js. One office Google account consents once to the
 * `https://www.googleapis.com/auth/calendar.events` scope; its refresh token is
 * kept as an Edge Function secret and never reaches the browser. Supabase's own
 * Google sign-in token is not used: it is not refreshed, and staff may sign in
 * with a password.
 *
 * Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
 * GOOGLE_CALENDAR_REFRESH_TOKEN, and optionally GOOGLE_CALENDAR_ID (default
 * `primary`). With any of the first three missing the integration reports
 * `configured: false` and the app falls back to a pasted meeting link.
 *
 * Google OAuth note: while the OAuth consent screen is in "Testing" status,
 * refresh tokens expire after 7 days. Publish the app (the unverified-app
 * warning is acceptable for the single consenting office account) or use an
 * internal Google Workspace app so the token keeps working.
 */
import { INTERVIEW_TIME_ZONE, getInterviewEndsAt } from './interview.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

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

const readError = async (response) => {
  try {
    const body = await response.json();
    return body?.error?.message || body?.error_description || body?.error || `Google responded with ${response.status}`;
  } catch {
    return `Google responded with ${response.status}`;
  }
};

export const fetchGoogleAccessToken = async (config, fetchImpl = fetch) => {
  try {
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!response.ok) return { ok: false, error: await readError(response) };
    const body = await response.json();
    return body?.access_token ? { ok: true, accessToken: body.access_token } : { ok: false, error: 'Google returned no access token' };
  } catch (error) {
    return { ok: false, error: error?.message || 'Unable to reach Google' };
  }
};

/**
 * The Calendar event for an interview. The guest list is hidden from guests
 * (`guestsCanSeeOtherGuests: false`) so the applicant never sees the panel
 * members' names or emails through the invitation, matching the app.
 */
export const buildGoogleInterviewEvent = ({ schedule, scholarshipTitle = '', school = '', attendees = [], requestId = '' }) => {
  const isOnline = schedule.mode === 'online';
  const manualLink = isOnline ? String(schedule.meetingUrl || '').trim() : '';
  const description = [
    `ScholarPath AdDU scholarship interview${scholarshipTitle ? ` for ${scholarshipTitle}` : ''}.`,
    school ? `Interview panel from ${school}.` : '',
    manualLink ? `Join: ${manualLink}` : '',
    schedule.instructions || '',
  ].filter(Boolean).join('\n');
  const event = {
    summary: `Scholarship interview${scholarshipTitle ? ` · ${scholarshipTitle}` : ''}`,
    description,
    location: isOnline ? (manualLink || 'Online') : (schedule.locationLabel || ''),
    start: { dateTime: new Date(schedule.startsAt).toISOString(), timeZone: INTERVIEW_TIME_ZONE },
    end: { dateTime: getInterviewEndsAt(schedule).toISOString(), timeZone: INTERVIEW_TIME_ZONE },
    attendees: attendees
      .filter((entry) => entry?.email)
      .map((entry) => ({ email: entry.email, ...(entry.name ? { displayName: entry.name } : {}) })),
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
  };
  if (isOnline && !manualLink && requestId) {
    event.conferenceData = { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
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
 * `{ ok, eventId, htmlLink, meetingUrl }` or `{ ok: false, error }`.
 */
export const upsertGoogleInterviewEvent = async ({ config, accessToken, event, eventId = null, fetchImpl = fetch }) => {
  const params = { conferenceDataVersion: '1', sendUpdates: 'all' };
  try {
    const response = await fetchImpl(eventId ? eventsUrl(config, `/${encodeURIComponent(eventId)}`, params) : eventsUrl(config, '', params), {
      method: eventId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) return { ok: false, error: await readError(response) };
    let saved = await response.json();
    // Meet creation is usually immediate; when Google reports it as pending,
    // read the event once more for the link.
    if (!extractMeetLink(saved) && saved?.conferenceData?.createRequest?.status?.statusCode === 'pending') {
      const again = await fetchImpl(eventsUrl(config, `/${encodeURIComponent(saved.id)}`), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (again.ok) saved = await again.json();
    }
    return { ok: true, eventId: saved.id, htmlLink: saved.htmlLink || '', meetingUrl: extractMeetLink(saved) };
  } catch (error) {
    return { ok: false, error: error?.message || 'Unable to reach Google Calendar' };
  }
};

export const cancelGoogleInterviewEvent = async ({ config, accessToken, eventId, fetchImpl = fetch }) => {
  try {
    const response = await fetchImpl(eventsUrl(config, `/${encodeURIComponent(eventId)}`, { sendUpdates: 'all' }), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // An event that is already gone counts as cancelled.
    if (response.ok || response.status === 404 || response.status === 410) return { ok: true };
    return { ok: false, error: await readError(response) };
  } catch (error) {
    return { ok: false, error: error?.message || 'Unable to reach Google Calendar' };
  }
};
