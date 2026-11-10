import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../supabase/migrations/20261105000000_scope_results_release_reads.sql', import.meta.url), 'utf8');
const batchReleaseMigration = readFileSync(new URL('../supabase/migrations/20261105000004_batch_results_release.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

describe('results release access migration', () => {
  it('removes direct authenticated access to the raw UUID array', () => {
    expect(migration).toMatch(/revoke select on public\.results_releases from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke all on public\.results_release_applications from public, anon, authenticated/i);
    expect(migration).not.toMatch(/create policy\s+"results_releases_read"[\s\S]{0,120}using\s*\(\s*true\s*\)/i);
  });

  it('returns only release coverage the caller can read and retains scholarship-level close metadata', () => {
    expect(migration).toMatch(/c\.role\s*=\s*'student'\s+and a\.student_id\s*=\s*c\.user_id/i);
    expect(migration).toMatch(/public\.reviewer_scopes_to_student\(a\.student_id\)/i);
    expect(migration).toMatch(/own_app\.scholarship_id\s*=\s*r\.scholarship_id[\s\S]{0,100}own_app\.student_id\s*=\s*c\.user_id/i);
    expect(migration).toMatch(/create function public\.get_scoped_results_releases\(p_since timestamptz default null\)[\s\S]*?security definer/i);
    expect(migration).toMatch(/grant execute on function public\.get_scoped_results_releases\(timestamptz\) to authenticated/i);
  });

  it('keeps the fresh-project schema aligned with the applied migration', () => {
    expect(schema).toContain('public.results_release_applications');
    expect(schema).toContain('public.can_read_application_result_release');
    expect(schema).toContain('public.get_scoped_results_releases(p_since timestamptz default null)');
    expect(schema).toContain('public.application_results_release_requests');
    expect(schema).toContain('public.release_scholarship_results(');
    expect(schema).toMatch(/revoke select on public\.results_releases from public, anon, authenticated/i);
  });
});

describe('first-wave results batch release', () => {
  it('locks release requests, enforces Admin authority, updates in one transaction, and replays the same request', () => {
    expect(batchReleaseMigration).toMatch(/if not public\.is_admissions_admin\(\)/i);
    expect(batchReleaseMigration).toMatch(/application_results_release_requests[\s\S]*request_id uuid primary key/i);
    expect(batchReleaseMigration).toMatch(/where request_id = p_request_id\s+for update/i);
    expect(batchReleaseMigration).toMatch(/update public\.applications a[\s\S]*status = 'Released'[\s\S]*a\.status = 'Approved'/i);
    expect(batchReleaseMigration).toMatch(/public\.record_results_release\(p_scholarship_id\)/i);
    expect(batchReleaseMigration).toMatch(/grant execute on function public\.release_scholarship_results\(uuid, date, uuid\) to authenticated/i);
  });
});
