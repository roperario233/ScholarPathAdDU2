import { afterEach, describe, expect, it } from 'vitest';
import { applications as seedApplications, createInitialState, documents as seedDocuments, storageKey } from '../src/lib/demoState';

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
  it('returns manuscript-aligned defaults when nothing is persisted', () => {
    installStorage(undefined);
    const state = createInitialState();

    expect(state.theme).toBe('light');
    expect(state.viewerRole).toBe('student');
    expect(state.customDeadlines).toEqual([]);
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
    expect(state.applications).toEqual(seedApplications);
    expect(state.documents).toEqual(seedDocuments);
  });

  it('returns defaults when window is unavailable (demo-safe)', () => {
    delete globalThis.window;
    const state = createInitialState();

    expect(state.customDeadlines).toEqual([]);
    expect(state.applications).toEqual(seedApplications);
  });

  it('preserves a saved dark theme instead of discarding the session', () => {
    const storage = installStorage({ theme: 'dark', customDeadlines: [], notifications: [] });

    const state = createInitialState();

    expect(state.theme).toBe('dark');
    // Regression guard: the old implementation removed the saved session entirely
    // for dark-theme users, which wiped reminders on every reload.
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

  it('restores persisted deadline reminder notifications', () => {
    installStorage({
      notifications: [
        { id: 'not-1', sourceKey: 'deadline-reminder-dl-1-7', title: 'Reminder: due in 7 days' },
      ],
    });

    const state = createInitialState();

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].sourceKey).toBe('deadline-reminder-dl-1-7');
  });

  it('backfills nested notification preferences for legacy saved sessions', () => {
    installStorage({ notificationPreferences: { inAppEnabled: false } });

    const state = createInitialState();

    expect(state.notificationPreferences.inAppEnabled).toBe(false);
    expect(state.notificationPreferences.emailEnabled).toBe(true);
    expect(state.notificationPreferences.deadlineReminders.dayBefore).toBe(true);
  });

  it('merges the saved profile draft over the defaults', () => {
    installStorage({ profileDraft: { qpi: 3.4 } });

    const state = createInitialState();

    expect(state.profileDraft.qpi).toBe(3.4);
    expect(state.profileDraft.degreeProgram).toBe('BS Computer Science');
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

  it('falls back to seed data when saved arrays are empty or malformed', () => {
    installStorage({ applications: [], documents: [], announcements: [], notifications: [] });

    const state = createInitialState();

    expect(state.applications).toEqual(seedApplications);
    expect(state.documents).toEqual(seedDocuments);
    expect(state.notifications.length).toBeGreaterThan(0);
  });

  it('restores demo My Profile edits and ignores malformed ones', () => {
    installStorage({ profileEdits: { 'user-student': { fullName: 'Ana Cruz' } } });
    expect(createInitialState().profileEdits).toEqual({ 'user-student': { fullName: 'Ana Cruz' } });

    installStorage({ profileEdits: ['not', 'an', 'object'] });
    expect(createInitialState().profileEdits).toEqual({});

    installStorage({ theme: 'dark' });
    expect(createInitialState().profileEdits).toEqual({});
  });

  it('survives corrupted localStorage payloads', () => {
    globalThis.window = { localStorage: createMemoryStorage({ [storageKey]: '{not json' }) };

    const state = createInitialState();

    expect(state.theme).toBe('light');
    expect(state.applications).toEqual(seedApplications);
  });
});
