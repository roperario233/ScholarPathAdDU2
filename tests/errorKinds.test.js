import { describe, expect, it } from 'vitest';
import { classifySupabaseError, describeSyncError, describeWriteError, isTransientErrorKind } from '../src/lib/errorKinds';

describe('classifySupabaseError', () => {
  it.each([
    [{ code: 'ABORTED', message: 'x' }, 'cancelled'],
    [{ name: 'AbortError', message: 'x' }, 'cancelled'],
    [{ message: 'JWT expired', status: 401 }, 'session'],
    [{ code: 'PGRST301', message: 'x' }, 'session'],
    [{ status: 429, message: 'x' }, 'rate-limit'],
    [{ message: 'Request rate limit reached' }, 'rate-limit'],
    [{ code: '42501', message: 'permission denied for table' }, 'permission'],
    [{ status: 403, message: 'x' }, 'permission'],
    [{ code: '23505', message: 'duplicate key' }, 'conflict'],
    [{ code: '40001', message: 'could not serialize' }, 'conflict'],
    [{ code: '23514', message: 'check violation' }, 'validation'],
    [{ code: '22023', message: 'invalid parameter' }, 'validation'],
    [{ code: 'PGRST116', message: 'no rows' }, 'not-found'],
    [{ message: 'TypeError: Failed to fetch' }, 'network'],
    [{ status: 503, message: 'x' }, 'server'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'server'],
    [{ message: 'something odd' }, 'unknown'],
    [null, 'unknown'],
  ])('classifies %j as %s', (error, kind) => {
    expect(classifySupabaseError(error)).toBe(kind);
  });

  it('marks only transient kinds as automatically retryable', () => {
    expect(['network', 'server', 'rate-limit'].every(isTransientErrorKind)).toBe(true);
    expect(['session', 'permission', 'validation', 'conflict', 'unknown'].some(isTransientErrorKind)).toBe(false);
  });
});

describe('error copy', () => {
  it('never echoes a raw database message for permission, server or network failures', () => {
    expect(describeWriteError({ code: '42501', message: 'new row violates row-level security policy for table "applications"' })).not.toContain('applications');
    expect(describeWriteError({ status: 500, message: 'relation "x" does not exist' })).not.toContain('relation');
  });

  it('keeps the database rule text for validation failures so the person can fix the value', () => {
    expect(describeWriteError({ code: '23514', message: 'Choose a confirm-by date that is today or later.' })).toBe('Choose a confirm-by date that is today or later.');
  });

  it('has a sentence for every kind the refresh can report', () => {
    ['session', 'permission', 'rate-limit', 'network', 'server', 'conflict', 'validation', 'not-found', 'unknown'].forEach((kind) => {
      expect(describeSyncError(kind).length).toBeGreaterThan(10);
    });
  });
});
