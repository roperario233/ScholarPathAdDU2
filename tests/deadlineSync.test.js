import { describe, expect, it } from 'vitest';
import { findDeadlinesMissingFromServer, isFutureDeadline, isRealUserId } from '../src/lib/deadlineSync';

const deadline = (id, overrides = {}) => ({
  id,
  title: 'CHED TES submission',
  deadline: '2026-10-09',
  ...overrides,
});

describe('isRealUserId', () => {
  it('accepts a Supabase auth UUID', () => {
    expect(isRealUserId('c9fb6f73-e5c9-463b-a39a-6a6f49197967')).toBe(true);
    expect(isRealUserId('C9FB6F73-E5C9-463B-A39A-6A6F49197967')).toBe(true);
    expect(isRealUserId('  c9fb6f73-e5c9-463b-a39a-6a6f49197967  ')).toBe(true);
  });

  it('rejects demo-mode ids so they are never sent as a uuid owner_id', () => {
    expect(isRealUserId('student-1')).toBe(false);
    expect(isRealUserId('demo-student')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isRealUserId(undefined)).toBe(false);
    expect(isRealUserId(null)).toBe(false);
    expect(isRealUserId('')).toBe(false);
    expect(isRealUserId(42)).toBe(false);
  });

  it('rejects a malformed UUID', () => {
    expect(isRealUserId('c9fb6f73-e5c9-463b-a39a-6a6f4919796')).toBe(false);
    expect(isRealUserId('c9fb6f73e5c9463ba39a6a6f49197967')).toBe(false);
  });
});

describe('findDeadlinesMissingFromServer', () => {
  it('returns every local deadline when the server has none', () => {
    const local = [deadline('custom-a'), deadline('custom-b')];
    expect(findDeadlinesMissingFromServer(local, [])).toHaveLength(2);
  });

  it('returns only the local deadlines absent from the server', () => {
    const local = [deadline('custom-a'), deadline('custom-b'), deadline('custom-c')];
    const server = [deadline('custom-b')];

    const missing = findDeadlinesMissingFromServer(local, server);

    expect(missing.map((entry) => entry.id)).toEqual(['custom-a', 'custom-c']);
  });

  it('returns nothing when local and server agree', () => {
    const local = [deadline('custom-a')];
    expect(findDeadlinesMissingFromServer(local, [deadline('custom-a')])).toEqual([]);
  });

  it('tolerates missing or malformed collections', () => {
    expect(findDeadlinesMissingFromServer(undefined, undefined)).toEqual([]);
    expect(findDeadlinesMissingFromServer(null, null)).toEqual([]);
    expect(findDeadlinesMissingFromServer([], [deadline('custom-a')])).toEqual([]);
    expect(findDeadlinesMissingFromServer([deadline('custom-a')], undefined)).toHaveLength(1);
  });

  it('ignores entries without an id on either side', () => {
    const local = [deadline('custom-a'), { title: 'no id', deadline: '2026-10-09' }];
    const server = [{ title: 'server row without id' }];

    expect(findDeadlinesMissingFromServer(local, server).map((entry) => entry.id)).toEqual(['custom-a']);
  });

  it('does not treat a different id as already synced', () => {
    const local = [deadline('custom-a')];
    expect(findDeadlinesMissingFromServer(local, [deadline('custom-z')])).toHaveLength(1);
  });
});

describe('isFutureDeadline', () => {
  it('accepts today and any later date', () => {
    expect(isFutureDeadline('2026-10-02', '2026-10-02')).toBe(true);
    expect(isFutureDeadline('2026-10-03', '2026-10-02')).toBe(true);
    expect(isFutureDeadline('2027-01-01', '2026-10-02')).toBe(true);
  });

  it('rejects a deadline that has already passed', () => {
    expect(isFutureDeadline('2026-10-01', '2026-10-02')).toBe(false);
    expect(isFutureDeadline('2026-09-20', '2026-10-02')).toBe(false);
  });

  it('uses only the date part of an ISO timestamp', () => {
    expect(isFutureDeadline('2026-10-05T00:00:00', '2026-10-02')).toBe(true);
    expect(isFutureDeadline('2026-10-01T23:59:59', '2026-10-02')).toBe(false);
  });

  it('rejects malformed or missing values instead of syncing them', () => {
    expect(isFutureDeadline(undefined, '2026-10-02')).toBe(false);
    expect(isFutureDeadline('', '2026-10-02')).toBe(false);
    expect(isFutureDeadline('next week', '2026-10-02')).toBe(false);
    expect(isFutureDeadline('05/10/2026', '2026-10-02')).toBe(false);
  });

  it('rejects everything when no day key is supplied', () => {
    expect(isFutureDeadline('2026-10-05', undefined)).toBe(false);
    expect(isFutureDeadline('2026-10-05', '')).toBe(false);
  });
});
