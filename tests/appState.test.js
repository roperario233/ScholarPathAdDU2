import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, normalizeDocument, serializePersistedState, storageKey } from '../src/lib/appState';

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

  it('hides the summary cards until an account opts in, and keeps only real choices', () => {
    installStorage(undefined);
    expect(createInitialState().summaryCardsByOwner).toEqual({});

    installStorage({ summaryCardsByOwner: { 'user-1': true, 'user-2': false, 'user-3': 'yes' } });
    expect(createInitialState().summaryCardsByOwner).toEqual({ 'user-1': true });

    installStorage({ summaryCardsByOwner: ['user-1'] });
    expect(createInitialState().summaryCardsByOwner).toEqual({});
  });

  it('defaults the staff student directory to an empty object', () => {
    installStorage(undefined);
    expect(createInitialState().students).toEqual({});
  });

  it('does not restore server-backed student directory data from localStorage', () => {
    installStorage({ students: { 'user-1': { fullName: 'Ada', department: 'College of Computer Studies (CCS)' } } });
    const state = createInitialState();
    expect(state.students).toEqual({});
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

  it('restores an Admissions Office workspace route', () => {
    installStorage({ activeView: 'admin-review' });

    expect(createInitialState().activeView).toBe('admin-review');
  });

  it('falls back to the dashboard for a view the app cannot render', () => {
    installStorage({ activeView: 'admin-console-legacy' });

    expect(createInitialState().activeView).toBe('dashboard');
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

  it('restores an Admissions Office Admin session', () => {
    installStorage({
      viewerRole: 'admissions_admin',
      savedRole: 'admissions_admin',
      authUser: { id: 'admin-1', role: 'admissions_admin', fullName: 'Office Admin' },
    });

    const state = createInitialState();

    expect(state.viewerRole).toBe('admissions_admin');
    expect(state.savedRole).toBe('admissions_admin');
    expect(state.authUser.role).toBe('admissions_admin');
  });

  it('migrates a session saved under the earlier Admin role name', () => {
    installStorage({
      viewerRole: 'admissions_head',
      savedRole: 'admissions_head',
      authUser: { id: 'admin-1', role: 'admissions_head', fullName: 'Office Admin' },
    });

    const state = createInitialState();

    expect(state.viewerRole).toBe('admissions_admin');
    expect(state.savedRole).toBe('admissions_admin');
    expect(state.authUser.role).toBe('admissions_admin');
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

  it('normalizes the stored storage-notice choice', () => {
    // Unanswered: the notice is shown, and nothing optional is granted.
    globalThis.window = { localStorage: createMemoryStorage({ [storageKey]: JSON.stringify({ theme: 'dark' }) }) };
    expect(createInitialState().privacyChoice).toEqual({ version: '', decidedAt: null, supportChat: false });

    // A junk record reads as unanswered rather than breaking the session.
    globalThis.window = { localStorage: createMemoryStorage({ [storageKey]: JSON.stringify({ privacyChoice: 'accepted' }) }) };
    expect(createInitialState().privacyChoice.version).toBe('');

    // A stored record is kept, and only a strict `true` grants the optional category.
    globalThis.window = {
      localStorage: createMemoryStorage({
        [storageKey]: JSON.stringify({ privacyChoice: { version: '2026-11-1', decidedAt: '2026-11-05T08:00:00.000Z', supportChat: 'yes' } }),
      }),
    };
    expect(createInitialState().privacyChoice).toEqual({ version: '2026-11-1', decidedAt: '2026-11-05T08:00:00.000Z', supportChat: false });
  });

  it('never persists the per-case history flags or rows of a staff session', () => {
    const stored = JSON.parse(serializePersistedState({
      theme: 'dark',
      workspaceDetailsReady: true,
      detailsDeferred: true,
      reviewComments: [{ id: 'c1' }],
      interviewNotes: [{ id: 'n1' }],
    }));
    expect(stored.theme).toBe('dark');
    ['workspaceDetailsReady', 'detailsDeferred', 'reviewComments', 'interviewNotes'].forEach((key) => {
      expect(stored[key]).toBeUndefined();
    });
  });

  it('starts every session with the per-case history marked not yet loaded', () => {
    expect(createInitialState().workspaceDetailsReady).toBe(false);
  });

  it('serializes preferences and owned local reminders but omits server-backed workspace rows', () => {
    const serialized = serializePersistedState({
      ownerId: 'user-1',
      theme: 'dark',
      profileDraft: { qpi: '3.5' },
      customDeadlines: [{ id: 'dl-1' }],
      applications: [{ id: 'app-1' }],
      documents: [{ id: 'doc-1' }],
      students: { 'user-1': { fullName: 'Ada' } },
      notifications: [
        { id: 'local-1', sourceKey: 'deadline-reminder-dl-1-7', ownerId: 'user-1' },
        { id: 'local-other', sourceKey: 'deadline-reminder-dl-2-7', ownerId: 'user-2' },
        { id: 'remote-1', source_key: 'application-status-app-1-Submitted' },
      ],
    });
    const stored = JSON.parse(serialized);

    expect(stored.theme).toBe('dark');
    expect(stored.profileDraft).toEqual({ qpi: '3.5' });
    expect(stored.customDeadlines).toEqual([{ id: 'dl-1' }]);
    expect(stored.applications).toBeUndefined();
    expect(stored.documents).toBeUndefined();
    expect(stored.students).toBeUndefined();
    expect(stored.notifications).toEqual([{ id: 'local-1', sourceKey: 'deadline-reminder-dl-1-7', ownerId: 'user-1' }]);
  });
});

describe('normalizeDocument', () => {
  it('defaults a missing linkedAttributes list to empty so old sessions load', () => {
    expect(normalizeDocument({ id: 'a' }).linkedAttributes).toEqual([]);
    expect(normalizeDocument({ id: 'b', linkedAttributes: ['qpi'] }).linkedAttributes).toEqual(['qpi']);
  });

  it('defaults missing or malformed attestedValues to an empty object', () => {
    expect(normalizeDocument({ id: 'a' }).attestedValues).toEqual({});
    expect(normalizeDocument({ id: 'b', attestedValues: ['qpi'] }).attestedValues).toEqual({});
    expect(normalizeDocument({ id: 'c', attestedValues: { qpi: 3.2 } }).attestedValues).toEqual({ qpi: 3.2 });
  });
});
