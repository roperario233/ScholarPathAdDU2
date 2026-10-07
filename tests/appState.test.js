import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, normalizeDocument, storageKey } from '../src/lib/appState';

const legacyStorageKey = 'scholarpath-addu-demo-state';

const createMemoryStorage = (seed = {}) => {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
};

const installStorage = (storedState) => {
  const storage = createMemoryStorage(
    storedState === undefined ? {} : { [storageKey]: JSON.stringify(storedState) },
  );
  globalThis.window = { localStorage: storage };
  return storage;
};

afterEach(() => {
  delete globalThis.window;
});

describe('createInitialState', () => {
  it('returns empty, manuscript-aligned defaults when nothing is persisted', () => {
    installStorage(undefined);
    const state = createInitialState();

    expect(state.theme).toBe('light');
    expect(state.viewerRole).toBe('student');
    expect(state.authUser).toBeNull();
    expect(state.profileDraft.degreeProgram).toBe('');
    expect(state.customDeadlines).toEqual([]);
    expect(state.applications).toEqual([]);
    expect(state.documents).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(state.announcements).toEqual([]);
    expect(state.notificationPreferences).toEqual({
      smsEnabled: true,
      emailEnabled: true,
      inAppEnabled: true,
      deadlineReminders: {
        oneWeekBefore: true,
        threeDaysBefore: true,
        dayBefore: true,
      },
    });
  });

  it('returns defaults when window is unavailable', () => {
    delete globalThis.window;
    const state = createInitialState();

    expect(state.customDeadlines).toEqual([]);
    expect(state.applications).toEqual([]);
  });

  it('preserves a saved dark theme instead of discarding the session', () => {
    const storage = installStorage({ theme: 'dark', customDeadlines: [], notifications: [] });

    const state = createInitialState();

    expect(state.theme).toBe('dark');
    expect(storage.getItem(storageKey)).not.toBeNull();
  });

  it('redirects saved Eligibility Checker sessions to Scholarships', () => {
    installStorage({ activeView: 'eligibility' });

    expect(createInitialState().activeView).toBe('explore');
  });

  it('restores persisted custom deadlines', () => {
    installStorage({
      customDeadlines: [
        { id: 'dl-1', title: 'CHED TES submission', deadline: '2026-10-15', type: 'personal' },
      ],
    });

    const state = createInitialState();

    expect(state.customDeadlines).toHaveLength(1);
    expect(state.customDeadlines[0].id).toBe('dl-1');
  });

  it('backfills nested notification preferences for legacy saved sessions', () => {
    installStorage({ notificationPreferences: { inAppEnabled: false } });

    const state = createInitialState();

    expect(state.notificationPreferences.inAppEnabled).toBe(false);
    expect(state.notificationPreferences.emailEnabled).toBe(true);
    expect(state.notificationPreferences.deadlineReminders.dayBefore).toBe(true);
  });

  it('migrates saved OSA administrator sessions to the Admissions Office role', () => {
    installStorage({
      viewerRole: 'osa_admin',
      savedRole: 'osa_admin',
      authUser: { id: 'staff-1', role: 'osa_admin', fullName: 'Office Admin' },
    });

    const state = createInitialState();

    expect(state.viewerRole).toBe('admissions_office');
    expect(state.savedRole).toBe('admissions_office');
    expect(state.authUser.role).toBe('admissions_office');
  });

  it('carries over only theme, preferences, and deadlines from the legacy demo key', () => {
    const storage = createMemoryStorage({
      [legacyStorageKey]: JSON.stringify({
        theme: 'dark',
        notificationPreferences: { inAppEnabled: false },
        customDeadlines: [{ id: 'dl-9', title: 'Legacy', deadline: '2026-11-01' }],
        applications: [{ id: 'app-legacy' }],
        documents: [{ id: 'doc-legacy' }],
      }),
    });
    globalThis.window = { localStorage: storage };

    const state = createInitialState();

    expect(state.theme).toBe('dark');
    expect(state.notificationPreferences.inAppEnabled).toBe(false);
    expect(state.customDeadlines).toHaveLength(1);
    expect(state.customDeadlines[0].id).toBe('dl-9');
    // Seeded demo records are dropped, never resurrected.
    expect(state.applications).toEqual([]);
    expect(state.documents).toEqual([]);
    // The legacy key is consumed and the new key becomes authoritative.
    expect(storage.getItem(storageKey)).not.toBeNull();
    expect(storage.getItem(legacyStorageKey)).toBeNull();
  });

  it('survives corrupted localStorage payloads', () => {
    globalThis.window = { localStorage: createMemoryStorage({ [storageKey]: '{not json' }) };

    const state = createInitialState();

    expect(state.theme).toBe('light');
    expect(state.applications).toEqual([]);
  });
});

describe('normalizeDocument', () => {
  it('defaults a missing linkedAttributes list to empty so old sessions load', () => {
    expect(normalizeDocument({ id: 'a' }).linkedAttributes).toEqual([]);
    expect(normalizeDocument({ id: 'b', linkedAttributes: ['qpi'] }).linkedAttributes).toEqual(['qpi']);
  });
});
