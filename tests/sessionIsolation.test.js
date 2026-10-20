import { afterEach, describe, expect, it } from 'vitest';
import { createFreshState, createInitialState, storageKey } from '../src/lib/appState';
import { filterLocalDeadlinesForOwner } from '../src/lib/deadlineSync';
import { mergeNotifications } from '../src/lib/notificationMerge';

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

describe('createFreshState (sign-out reset)', () => {
  const previous = {
    ownerId: 'user-a',
    theme: 'dark',
    hasLoggedInBefore: true,
    rememberMe: true,
    savedEmail: 'student-a@addu.edu.ph',
    savedRole: 'student',
    isAuthenticated: true,
    viewerRole: 'student',
    activeView: 'applications',
    authUser: { id: 'user-a', fullName: 'Student A' },
    profileDraft: { degreeProgram: 'BS Computer Science', qpi: '3.5' },
    notifications: [{ id: 'not-1', sourceKey: 'deadline-reminder-custom-1-7' }],
    customDeadlines: [{ id: 'custom-1', ownerId: 'user-a' }],
    applications: [{ id: 'app-1', studentId: 'user-a' }],
    documents: [{ id: 'doc-1', ownerId: 'user-a' }],
    students: { 'user-a': { fullName: 'Student A' } },
    announcements: [{ id: 'ann-1' }],
  };

  it('clears every session-scoped slice the previous user owned', () => {
    const next = createFreshState(previous);

    expect(next.ownerId).toBeNull();
    expect(next.isAuthenticated).toBe(false);
    expect(next.authUser).toBeNull();
    expect(next.viewerRole).toBe('student');
    expect(next.activeView).toBe('dashboard');
    expect(next.profileDraft).toEqual({
      qpi: '',
      householdIncome: '',
      degreeProgram: '',
      hasActiveGovernmentGrant: false,
    });
    expect(next.notifications).toEqual([]);
    expect(next.customDeadlines).toEqual([]);
    expect(next.applications).toEqual([]);
    expect(next.documents).toEqual([]);
    expect(next.students).toEqual({});
    expect(next.announcements).toEqual([]);
  });

  it('keeps only the non-identifying device-level preferences', () => {
    const next = createFreshState(previous);

    expect(next.theme).toBe('dark');
    expect(next.hasLoggedInBefore).toBe(true);
  });

  it('resets the previous user\'s remember-me identity', () => {
    const next = createFreshState(previous);

    expect(next.rememberMe).toBe(false);
    expect(next.savedEmail).toBeNull();
    expect(next.savedRole).toBe('student');
  });

  it('falls back to defaults when no preferences are supplied', () => {
    const next = createFreshState();

    expect(next.theme).toBe('light');
    expect(next.hasLoggedInBefore).toBe(false);
    expect(next.ownerId).toBeNull();
  });
});

describe('persisted owner stamp', () => {
  it('restores the ownerId written by the previous session', () => {
    installStorage({ ownerId: 'user-a', theme: 'dark' });

    expect(createInitialState().ownerId).toBe('user-a');
  });

  it('defaults ownerId to null for records written before the field existed', () => {
    installStorage({ theme: 'dark', customDeadlines: [] });

    expect(createInitialState().ownerId).toBeNull();
  });

  it('ignores a malformed ownerId', () => {
    installStorage({ ownerId: { not: 'a string' } });

    expect(createInitialState().ownerId).toBeNull();
  });
});

describe('mergeNotifications user scoping', () => {
  const reminder = (overrides = {}) => ({
    id: 'not-reminder-1',
    sourceKey: 'deadline-reminder-custom-1-7',
    title: 'Reminder: "CHED TES" due in 7 days',
    ...overrides,
  });

  it('does not inherit non-reminder local entries when the remote list is empty', () => {
    const local = [
      { id: 'not-seed', title: 'Welcome to ScholarPath AdDU' },
      reminder({ ownerId: 'user-a' }),
    ];

    const merged = mergeNotifications(local, [], { ownerId: 'user-a' });

    expect(merged.map((entry) => entry.id)).toEqual(['not-reminder-1']);
  });

  it('returns nothing when the remote list is empty and no owned reminders exist', () => {
    const local = [{ id: 'not-seed', title: 'Welcome to ScholarPath AdDU' }];

    expect(mergeNotifications(local, [], { ownerId: 'user-b' })).toEqual([]);
  });

  it('drops a reminder owned by a different user', () => {
    const local = [reminder({ ownerId: 'user-a' })];

    expect(mergeNotifications(local, [], { ownerId: 'user-b' })).toEqual([]);
  });

  it('keeps a reminder owned by the signed-in user', () => {
    const local = [reminder({ ownerId: 'user-a' })];

    expect(mergeNotifications(local, [], { ownerId: 'user-a' })).toHaveLength(1);
  });

  it('keeps a legacy reminder that carries no ownerId', () => {
    const local = [reminder()];

    expect(mergeNotifications(local, [], { ownerId: 'user-b' })).toHaveLength(1);
  });
});

describe('filterLocalDeadlinesForOwner', () => {
  const deadline = (id, ownerId) => ({ id, title: id, deadline: '2026-12-01', ...(ownerId ? { ownerId } : {}) });

  it('keeps only the deadlines owned by the signed-in user', () => {
    const local = [deadline('custom-a', 'user-a'), deadline('custom-b', 'user-b')];

    expect(filterLocalDeadlinesForOwner(local, 'user-a').map((entry) => entry.id)).toEqual(['custom-a']);
  });

  it('keeps legacy deadlines without an ownerId', () => {
    const local = [deadline('custom-legacy')];

    expect(filterLocalDeadlinesForOwner(local, 'user-a')).toHaveLength(1);
  });

  it('returns every entry when no owner is supplied', () => {
    const local = [deadline('custom-a', 'user-a'), deadline('custom-b', 'user-b')];

    expect(filterLocalDeadlinesForOwner(local, undefined)).toHaveLength(2);
  });

  it('tolerates malformed collections', () => {
    expect(filterLocalDeadlinesForOwner(undefined, 'user-a')).toEqual([]);
    expect(filterLocalDeadlinesForOwner(null, 'user-a')).toEqual([]);
  });
});

