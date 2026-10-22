import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SESSION_TIMEOUTS,
  SESSION_ACTIVITY_STORAGE_KEY,
  consumePendingSessionStart,
  getSessionTimeoutConfig,
  getSessionTiming,
  markPendingSessionStart,
  markSessionEnded,
  readSessionActivity,
  startSessionActivity,
  subscribeToSessionActivity,
  touchSessionActivity,
} from '../src/lib/sessionTimeout';

const installStorage = () => {
  const values = new Map();
  const listeners = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = {
    localStorage: storage,
    sessionStorage: storage,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    dispatchStorage: (key) => listeners.get('storage')?.({ key }),
  };
  return { storage, values };
};

afterEach(() => {
  delete globalThis.window;
  vi.restoreAllMocks();
});

describe('session timeout policy', () => {
  const config = {
    ...DEFAULT_SESSION_TIMEOUTS,
    idleTimeoutMs: 15 * 60 * 1000,
    absoluteTimeoutMs: 12 * 60 * 60 * 1000,
    warningMs: 60 * 1000,
  };

  it('expires on inactivity and marks the warning window', () => {
    const startedAt = 1_000_000;
    const lastActivityAt = startedAt;
    expect(getSessionTiming({ startedAt, lastActivityAt, now: lastActivityAt + config.idleTimeoutMs - 30_000, config }))
      .toMatchObject({ reason: 'idle', isWarning: true, isExpired: false, msUntilExpiry: 30_000 });
    expect(getSessionTiming({ startedAt, lastActivityAt, now: lastActivityAt + config.idleTimeoutMs, config }))
      .toMatchObject({ reason: 'idle', isExpired: true, msUntilExpiry: 0 });
  });

  it('never allows activity to extend the absolute lifetime', () => {
    const startedAt = 2_000_000;
    const lastActivityAt = startedAt + 11 * 60 * 60 * 1000 + 59 * 60 * 1000;
    expect(getSessionTiming({ startedAt, lastActivityAt, now: startedAt + 12 * 60 * 60 * 1000, config }))
      .toMatchObject({ reason: 'absolute', isExpired: true });
  });

  it('selects the idle limit when it expires before the absolute limit', () => {
    const startedAt = 2_000_000;
    const lastActivityAt = startedAt + 10 * 60 * 60 * 1000;
    expect(getSessionTiming({ startedAt, lastActivityAt, now: lastActivityAt + config.idleTimeoutMs, config }))
      .toMatchObject({ reason: 'idle', isExpired: true });
  });

  it('requires valid timestamps instead of silently accepting an unknown session age', () => {
    expect(getSessionTiming({ startedAt: null, lastActivityAt: null, config }))
      .toMatchObject({ isExpired: true, reason: 'invalid' });
    expect(getSessionTiming({ startedAt: 5000, lastActivityAt: 4000, now: 6000, config }))
      .toMatchObject({ isExpired: true, reason: 'invalid' });
  });

  it('loads bounded environment overrides with secure defaults', () => {
    expect(getSessionTimeoutConfig({})).toMatchObject({ idleTimeoutMs: 15 * 60 * 1000, absoluteTimeoutMs: 12 * 60 * 60 * 1000 });
    expect(getSessionTimeoutConfig({ VITE_SESSION_IDLE_TIMEOUT_MINUTES: '0', VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS: '999' }))
      .toMatchObject({ idleTimeoutMs: 15 * 60 * 1000, absoluteTimeoutMs: 7 * 24 * 60 * 60 * 1000 });
  });
});

describe('session activity record', () => {
  it('starts a new owner-scoped session and throttles activity updates', () => {
    installStorage();
    expect(startSessionActivity({ ownerId: 'user-a', startedAt: 1000, lastActivityAt: 1000 })).toMatchObject({ ownerId: 'user-a', startedAt: 1000 });
    expect(touchSessionActivity({ ownerId: 'user-a', now: 2000, throttleMs: 5000 }).lastActivityAt).toBe(1000);
    expect(touchSessionActivity({ ownerId: 'user-a', now: 7000, throttleMs: 5000 }).lastActivityAt).toBe(7000);
    expect(touchSessionActivity({ ownerId: 'user-b', now: 10_000, throttleMs: 0 })).toBeNull();
    expect(readSessionActivity().ownerId).toBe('user-a');
  });

  it('marks cross-tab termination and emits storage updates', () => {
    const { values } = installStorage();
    startSessionActivity({ ownerId: 'user-a', startedAt: 1000, lastActivityAt: 1000 });
    const onChange = vi.fn();
    const unsubscribe = subscribeToSessionActivity(onChange);
    window.dispatchStorage(SESSION_ACTIVITY_STORAGE_KEY);
    expect(onChange).toHaveBeenCalledWith(readSessionActivity());
    expect(markSessionEnded({ ownerId: 'user-a', reason: 'idle', now: 9000 })).toMatchObject({ endedAt: 9000, endReason: 'idle' });
    expect(values.has(SESSION_ACTIVITY_STORAGE_KEY)).toBe(true);
    unsubscribe();
  });

  it('consumes a recent OAuth sign-in timestamp only once', () => {
    const { values } = installStorage();
    markPendingSessionStart(5000);
    expect(consumePendingSessionStart({ now: 6000 })).toBe(5000);
    expect(consumePendingSessionStart({ now: 6000 })).toBeNull();
    values.set('scholarpath-addu-pending-session-start', '1000');
    expect(consumePendingSessionStart({ now: 20 * 60 * 1000 })).toBeNull();
  });
});