import { describe, expect, it, vi } from 'vitest';

// A Supabase Postgrest builder is only a thenable: it has .then but no .catch
// and no .finally. The endorsement audit helper must therefore hand back a real
// Promise, or a fire-and-forget `.catch(...)` call throws and leaves the review
// dialog stuck on "Saving…".
vi.mock('../src/lib/supabaseClient', () => {
  const result = { data: { id: 'review-1' }, error: null };
  const postgrestThenable = { then: (resolve) => resolve(result) };
  return {
    hasSupabaseConfig: true,
    isSupabaseReady: true,
    supabase: {
      from: () => ({
        upsert: () => ({ select: () => ({ single: () => postgrestThenable }) }),
      }),
    },
  };
});

import { upsertSupabaseDepartmentReview } from '../src/lib/supabaseData';

describe('upsertSupabaseDepartmentReview', () => {
  it('returns a real promise so the fire-and-forget audit write can be caught', async () => {
    const pending = upsertSupabaseDepartmentReview({
      applicationId: 'app-1',
      reviewerId: 'chair-1',
      status: 'Endorsed',
    });

    expect(typeof pending.then).toBe('function');
    expect(typeof pending.catch).toBe('function');
    await expect(pending).resolves.toMatchObject({ data: { id: 'review-1' } });
  });
});
