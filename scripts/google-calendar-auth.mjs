#!/usr/bin/env node
/**
 * Mints the Google Calendar refresh token the interview integration needs.
 *
 *   $env:GOOGLE_OAUTH_CLIENT_ID="..."; $env:GOOGLE_OAUTH_CLIENT_SECRET="..."
 *   npm run google:auth
 *
 * A browser window opens on Google's consent screen. Sign in with the account
 * that OWNS the interview calendar (or has "Make changes to events" on it) — the
 * refresh token is bound to that account, so signing in with a different one is
 * how a "404 Not Found" from Calendar usually starts.
 *
 * The script prints the connected account, every calendar that account can write
 * to (with its ID and access role), the refresh token, and the exact
 * `supabase secrets set` command.
 *
 * Node 20+, no dependencies. The loopback redirect must be registered on the
 * OAuth client: http://localhost:5555/oauth2callback
 *
 * `calendar.calendarlist.readonly` is requested here only so this helper can list
 * calendars. The Edge Function never uses it: the runtime scope is
 * `calendar.events`.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
  console.error('PowerShell: $env:GOOGLE_OAUTH_CLIENT_ID="..."; $env:GOOGLE_OAUTH_CLIENT_SECRET="..."');
  process.exit(1);
}

const state = randomBytes(16).toString('hex');
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
  state,
}).toString()}`;

const postForm = async (url, fields) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};

const getJson = async (url, accessToken) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
};

const line = (label, value) => console.log(`${label.padEnd(18)} ${value}`);

const report = async (code) => {
  const token = await postForm('https://oauth2.googleapis.com/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  if (!token.ok || !token.body.access_token) {
    console.error('\nToken exchange failed:', token.body.error || token.status, token.body.error_description || '');
    return;
  }
  if (!token.body.refresh_token) {
    console.error('\nNo refresh_token was returned. Revoke the app at');
    console.error('https://myaccount.google.com/permissions and run this again.');
    return;
  }

  const me = await getJson('https://www.googleapis.com/oauth2/v3/userinfo', token.body.access_token);
  const calendars = await getJson('https://www.googleapis.com/calendar/v3/users/me/calendarList', token.body.access_token);
  const writable = (calendars.body.items || []).filter((entry) => ['owner', 'writer'].includes(entry.accessRole));
  const suggested = writable.find((entry) => /scholarpath|interview/i.test(entry.summary || '')) || writable[0];

  console.log('\n=== Connected account ===');
  line('email', me.body.email || '(unknown)');
  line('scopes', String(token.body.scope || '').replace(/https:\/\/www\.googleapis\.com\/auth\//g, ''));

  console.log('\n=== Calendars this account can write to ===');
  if (!writable.length) {
    console.log('  None. Create the interview calendar in this account, or share it with it.');
  }
  writable.forEach((entry) => {
    console.log(`  - ${entry.summary} [${entry.accessRole}]`);
    console.log(`    ${entry.id}`);
  });

  console.log('\n=== Secrets ===');
  line('refresh token', token.body.refresh_token);
  line('calendar id', suggested ? suggested.id : '<copy the interview calendar id>');

  console.log('\n=== Apply them ===');
  console.log(`supabase secrets set "GOOGLE_OAUTH_CLIENT_ID=<your-client-id>" "GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>" "GOOGLE_CALENDAR_REFRESH_TOKEN=${token.body.refresh_token}" "GOOGLE_CALENDAR_ID=${suggested ? suggested.id : ''}"`);
  console.log('\nOr paste the same four values in the Dashboard: Project Settings -> Edge Functions -> Secrets.');
  console.log('Re-run this script every Monday while the OAuth app is External + Testing (7-day refresh tokens).\n');
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const returnedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  if (error) {
    res.end(`Google returned: ${error}\nClose this tab and read the terminal.`);
    console.error(`\nConsent was not granted (${error}).`);
    server.close();
    return;
  }
  if (!code || returnedState !== state) {
    res.end('Invalid callback. Close this tab and run the command again.');
    console.error('\nCallback state did not match. Run the command again.');
    server.close();
    return;
  }

  res.end('Authorization received. You can close this tab and return to the terminal.');
  try {
    await report(code);
  } catch (failure) {
    console.error('\nUnexpected failure:', failure?.message || failure);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('\nOpen this URL and approve it with the account that owns the interview calendar:\n');
  console.log(authUrl);
  console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...`);
});
