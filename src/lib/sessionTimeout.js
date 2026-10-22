export const SESSION_ACTIVITY_STORAGE_KEY = 'scholarpath-addu-session-activity';
export const PENDING_SESSION_START_KEY = 'scholarpath-addu-pending-session-start';

export const DEFAULT_SESSION_TIMEOUTS = {
  idleTimeoutMs: 15 * 60 * 1000,
  absoluteTimeoutMs: 12 * 60 * 60 * 1000,
  warningMs: 60 * 1000,
  activityThrottleMs: 5 * 1000,
  checkIntervalMs: 1000,
  revalidationIntervalMs: 30 * 1000,
};

const positiveNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

export const getSessionTimeoutConfig = (env = import.meta.env || {}) => {
  const idleTimeoutMs = positiveNumber(
    env.VITE_SESSION_IDLE_TIMEOUT_MINUTES,
    15,
    1,
    24 * 60,
  ) * 60 * 1000;
  const absoluteTimeoutMs = positiveNumber(
    env.VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS,
    12,
    1,
    7 * 24,
  ) * 60 * 60 * 1000;
  const requestedWarningMs = positiveNumber(
    env.VITE_SESSION_WARNING_SECONDS,
    60,
    1,
    60 * 60,
  ) * 1000;

  return {
    ...DEFAULT_SESSION_TIMEOUTS,
    idleTimeoutMs,
    absoluteTimeoutMs,
    // Keep a useful warning interval even when an environment override uses a
    // very short timeout for local testing.
    warningMs: Math.min(requestedWarningMs, Math.floor(Math.min(idleTimeoutMs, absoluteTimeoutMs) / 2)),
  };
};

const timestamp = (value) => {
  const result = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : Date.parse(value));
  return Number.isFinite(result) ? result : null;
};

export const getSessionTiming = ({ startedAt, lastActivityAt, now = Date.now(), config = getSessionTimeoutConfig() }) => {
  const started = timestamp(startedAt);
  const lastActivity = timestamp(lastActivityAt);
  if (started === null || lastActivity === null || started > now || lastActivity > now || lastActivity < started) {
    return {
      idleExpiresAt: null,
      absoluteExpiresAt: null,
      expiresAt: null,
      msUntilExpiry: null,
      isWarning: false,
      isExpired: true,
      reason: 'invalid',
    };
  }

  const idleExpiresAt = lastActivity + config.idleTimeoutMs;
  const absoluteExpiresAt = started + config.absoluteTimeoutMs;
  const expiresAt = Math.min(idleExpiresAt, absoluteExpiresAt);
  const reason = absoluteExpiresAt <= idleExpiresAt ? 'absolute' : 'idle';
  const msUntilExpiry = expiresAt - now;
  const isExpired = msUntilExpiry <= 0;

  return {
    idleExpiresAt,
    absoluteExpiresAt,
    expiresAt,
    msUntilExpiry: Math.max(0, msUntilExpiry),
    isWarning: !isExpired && msUntilExpiry <= config.warningMs,
    isExpired,
    reason,
  };
};

export const readSessionActivity = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record.ownerId !== 'string' || !record.ownerId) return null;
    return record;
  } catch {
    return null;
  }
};

export const startSessionActivity = ({ ownerId, startedAt = Date.now(), lastActivityAt = startedAt }) => {
  if (typeof window === 'undefined' || !ownerId) return null;
  const record = {
    ownerId,
    startedAt: timestamp(startedAt),
    lastActivityAt: timestamp(lastActivityAt),
    endedAt: null,
    endReason: null,
  };
  if (record.startedAt === null || record.lastActivityAt === null) return null;
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
};

// OAuth returns through a full-page navigation, so retain only the timestamp of
// the user-initiated sign-in attempt until Supabase returns the authenticated id.
export const markPendingSessionStart = (startedAt = Date.now()) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_SESSION_START_KEY, String(startedAt));
  } catch {
    // If storage is unavailable the OAuth session will be rejected on return;
    // requiring a fresh credential check is safer than starting an unbounded one.
  }
};

export const clearPendingSessionStart = () => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_SESSION_START_KEY);
  } catch {
    // No pending OAuth timestamp is safer than preserving an old attempt.
  }
};

export const consumePendingSessionStart = ({ now = Date.now(), maxAgeMs = 10 * 60 * 1000 } = {}) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_SESSION_START_KEY);
    window.sessionStorage.removeItem(PENDING_SESSION_START_KEY);
    const startedAt = timestamp(raw);
    return startedAt !== null && startedAt <= now && now - startedAt <= maxAgeMs ? startedAt : null;
  } catch {
    return null;
  }
};

export const touchSessionActivity = ({ ownerId, now = Date.now(), throttleMs = DEFAULT_SESSION_TIMEOUTS.activityThrottleMs } = {}) => {
  if (typeof window === 'undefined' || !ownerId) return null;
  const current = readSessionActivity();
  if (!current || current.ownerId !== ownerId || current.endedAt) return null;
  const lastActivityAt = timestamp(current.lastActivityAt);
  const sessionStartedAt = timestamp(current.startedAt);
  if (lastActivityAt === null || sessionStartedAt === null || now < sessionStartedAt || now < lastActivityAt) return current;
  if (lastActivityAt !== null && now - lastActivityAt < throttleMs) return current;
  const updated = { ...current, lastActivityAt: now };
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return current;
  }
};

export const markSessionEnded = ({ ownerId, reason = 'signed-out', now = Date.now() } = {}) => {
  if (typeof window === 'undefined' || !ownerId) return null;
  const current = readSessionActivity();
  if (!current || current.ownerId !== ownerId) return null;
  if (current.endedAt) return current;
  const ended = { ...current, endedAt: now, endReason: reason };
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, JSON.stringify(ended));
    return ended;
  } catch {
    return null;
  }
};

export const subscribeToSessionActivity = (onChange) => {
  if (typeof window === 'undefined' || typeof onChange !== 'function') return () => {};
  const handleStorage = (event) => {
    if (event.key === SESSION_ACTIVITY_STORAGE_KEY) onChange(readSessionActivity());
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
};

export const formatSessionDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? '' : 's'}`;
  const totalDays = Math.ceil(totalHours / 24);
  return `${totalDays} day${totalDays === 1 ? '' : 's'}`;
};