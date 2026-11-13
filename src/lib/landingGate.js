import { readStoredState } from './appState';
import { PENDING_SESSION_START_KEY } from './sessionTimeout';

// Whether a signed-out visitor sees the public landing page first or goes
// straight to the login screen. The landing page is for a first visit; anyone in
// the middle of signing in must never be sent through it.

// Keys Supabase Auth puts in the return URL. A successful OAuth return, a
// password-reset link, or an email-confirmation link carries a token, a PKCE
// `code`, or a `type`; a failed one carries the error payload that LoginScreen's
// readAuthRedirectError reads (`error` / `error_code` / `error_description`, and
// GoTrue's `sb` marker in the hash).
const AUTH_REDIRECT_KEYS = [
  'access_token',
  'refresh_token',
  'code',
  'token_hash',
  'type',
  'error',
  'error_code',
  'error_description',
  'sb',
];

export const hasAuthRedirectPayload = ({ search = '', hash = '' } = {}) => {
  const query = new URLSearchParams(String(search).replace(/^\?/, ''));
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ''));
  return AUTH_REDIRECT_KEYS.some((key) => query.has(key) || fragment.has(key));
};

const readPendingOAuth = () => {
  try {
    return Boolean(window.sessionStorage.getItem(PENDING_SESSION_START_KEY));
  } catch {
    return false;
  }
};

const readRememberedSignIn = () => {
  try {
    const stored = readStoredState();
    return Boolean(String(stored?.savedEmail || '').trim()) || stored?.rememberMe === true;
  } catch {
    return false;
  }
};

// The address, the pending-OAuth marker, and the "Remember me" record as they
// were when the app loaded. Supabase (detectSessionInUrl) strips the tokens from
// the address, hydrateSession consumes the marker, and a boot with no session
// resets the persisted record to device preferences only (dropping the
// remembered email), all a moment later. So all three are read once, at module
// evaluation, before any of that async work can run.
export const captureLandingEntry = () => {
  if (typeof window === 'undefined') return { search: '', hash: '', hasPendingOAuth: false, rememberedSignIn: false };
  return {
    search: window.location.search || '',
    hash: window.location.hash || '',
    hasPendingOAuth: readPendingOAuth(),
    rememberedSignIn: readRememberedSignIn(),
  };
};

const INITIAL_ENTRY = captureLandingEntry();

export const getInitialLandingEntry = () => INITIAL_ENTRY;

// Skip the landing page when the visitor is mid-flow: returning from Google
// OAuth, opening a password-reset or email-confirmation link, reading a session
// notice (idle or absolute timeout, a revoked session, a deactivated account), or
// coming back to a remembered email.
export const shouldSkipLanding = ({ entry = INITIAL_ENTRY, sessionNotice = '', savedEmail = '', rememberMe = false } = {}) => (
  Boolean(entry?.hasPendingOAuth)
  || Boolean(entry?.rememberedSignIn)
  || hasAuthRedirectPayload(entry || {})
  || Boolean(String(sessionNotice || '').trim())
  || Boolean(String(savedEmail || '').trim())
  || Boolean(rememberMe)
);
