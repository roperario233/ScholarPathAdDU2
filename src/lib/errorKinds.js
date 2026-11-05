// Sorts a Supabase/PostgREST/fetch failure into the few kinds the interface
// treats differently. The result never carries the original message through to
// a log or a banner as-is: a database message can name rows, columns or values.
import { isAbortError } from './supabasePaging';

export const ERROR_KINDS = ['cancelled', 'session', 'permission', 'rate-limit', 'conflict', 'validation', 'not-found', 'network', 'server', 'unknown'];

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const classifySupabaseError = (error) => {
  if (!error) return 'unknown';
  if (isAbortError(error)) return 'cancelled';

  const status = numeric(error.status ?? error.statusCode);
  const code = String(error.code ?? '');
  const message = String(error.message ?? error ?? '').toLowerCase();

  if (message.includes('jwt expired') || code === 'PGRST301' || status === 401) return 'session';
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) return 'rate-limit';
  if (code === '42501' || status === 403 || message.includes('row-level security') || message.includes('permission denied')) return 'permission';
  if (code === '23505' || code === '40001' || code === '40P01' || status === 409) return 'conflict';
  if (/^(22|23)/.test(code) || code === 'PGRST102' || status === 400 || status === 422) return 'validation';
  if (code === 'PGRST116' || status === 404 || status === 406) return 'not-found';
  if ((status !== null && status >= 500) || /^(08|53|54|55|57|58|XX)/.test(code) || /^PGRST(0|1[0-9]{2}|2)/.test(code) || message.includes('schema cache')) return 'server';
  if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network request failed') || message.includes('load failed') || message.includes('timeout')) return 'network';
  return 'unknown';
};

// Transient kinds are worth another automatic attempt on the next scheduled
// refresh; the others need a person (sign in again, ask for access, fix a value).
export const isTransientErrorKind = (kind) => kind === 'network' || kind === 'server' || kind === 'rate-limit';

const SYNC_MESSAGES = {
  session: 'Your session has expired. Sign in again to keep working.',
  permission: 'Your account no longer has access to some of this data. Ask the Admissions Office if this is unexpected.',
  'rate-limit': 'The service is busy. The latest data will load again shortly.',
  network: 'You appear to be offline. The page shows the last data that loaded.',
  server: 'The service could not be reached just now. The page shows the last data that loaded.',
  conflict: 'The data changed while it was loading. It will reload shortly.',
  validation: 'Some data could not be read. The page shows the last data that loaded.',
  'not-found': 'Some data could not be found. The page shows the last data that loaded.',
  unknown: 'The latest data could not be loaded. The page shows the last data that loaded.',
};

export const describeSyncError = (kind) => SYNC_MESSAGES[kind] || SYNC_MESSAGES.unknown;

const WRITE_MESSAGES = {
  session: 'Your session has expired. Sign in again, then repeat this action.',
  permission: 'Your account is not allowed to do this.',
  'rate-limit': 'The service is busy. Wait a moment, then try again.',
  conflict: 'Someone else changed this at the same time. Reload the case and check its current stage.',
  network: 'The action could not reach the service. Check your connection and try again.',
  server: 'The service could not complete the action. Try again in a moment.',
};

// Prefer the specific, already-written message for validation and not-found
// failures (they are the database's own rule text); fall back to a generic
// sentence for the kinds whose raw message would be noise.
export const describeWriteError = (error, fallback = 'The action could not be completed.') => {
  const kind = classifySupabaseError(error);
  if (kind === 'validation' || kind === 'not-found' || kind === 'unknown') return String(error?.message || fallback);
  return WRITE_MESSAGES[kind] || fallback;
};
