import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const outbox = read('../supabase/migrations/20261105000006_notification_outbox.sql');
const stageCounts = read('../supabase/migrations/20261105000005_application_stage_counts.sql');
const schema = read('../supabase/schema.sql');

describe('stage counts migration', () => {
  it('runs as the caller so row-level security decides which cases are counted', () => {
    expect(stageCounts).toMatch(/security invoker/i);
    expect(stageCounts).not.toMatch(/security definer/i);
    expect(stageCounts).toMatch(/grant execute on function public\.get_application_stage_counts\(\) to authenticated/i);
    expect(stageCounts).toMatch(/revoke all on function public\.get_application_stage_counts\(\) from public, anon/i);
  });

  it('returns counts only', () => {
    const returns = stageCounts.slice(stageCounts.indexOf('returns table'), stageCounts.indexOf('language sql'));
    expect(returns).toMatch(/status text/);
    expect(returns).toMatch(/application_count bigint/);
    expect(returns).not.toMatch(/student|snapshot|statement|income/i);
  });

  it('is mirrored in the reference schema', () => {
    expect(schema).toContain('create or replace function public.get_application_stage_counts()');
  });
});

describe('notification outbox migration', () => {
  it('keeps the dispatch settings and the queue out of reach of every API role', () => {
    ['notification_dispatch_config', 'notification_outbox', 'notification_delivery_attempts'].forEach((table) => {
      expect(outbox).toContain(`alter table public.${table} enable row level security;`);
      expect(outbox).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
    });
    [
      'dispatch_notification(text, jsonb, text)',
      'drain_notification_outbox(integer)',
      'reconcile_notification_outbox()',
      'run_notification_outbox()',
      'notification_outbox_send(text, jsonb)',
    ].forEach((signature) => {
      expect(outbox).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    });
  });

  it('copies the deployed URL and secret instead of carrying a placeholder to edit', () => {
    expect(outbox).not.toMatch(/<project-ref>\.supabase\.co\/functions/);
    expect(outbox).toMatch(/from pg_proc p[\s\S]*proname = 'notify_application_status_change'/);
    expect(outbox).toMatch(/raise exception 'notify_application_status_change\(\) has no deployed URL and secret to copy/);
  });

  it('records before it sends and never lets a dispatch problem fail the status write', () => {
    const dispatch = outbox.slice(
      outbox.indexOf('create or replace function public.dispatch_notification('),
      outbox.indexOf('create or replace function public.drain_notification_outbox'),
    );
    // The insert precedes the protected send, so rolling back the send block
    // cannot undo the queue row.
    expect(dispatch.indexOf('insert into public.notification_outbox')).toBeLessThan(dispatch.indexOf('v_request := public.notification_outbox_send'));
    expect(dispatch).toMatch(/exception when others then[\s\S]*update public\.notification_outbox set last_error/);
    expect(dispatch).toMatch(/scholarpath\.notify_direct_count/);
    expect(dispatch).toMatch(/v_direct >= 20/);
  });

  it('lets two worker runs share the queue and bounds each batch', () => {
    expect(outbox).toMatch(/for update skip locked/);
    expect(outbox).toMatch(/least\(coalesce\(p_limit, 100\), 500\)/);
    expect(outbox).toMatch(/cron\.schedule\('run-notification-outbox', '\* \* \* \* \*'/);
  });

  it('retries transient failures with backoff and treats a permanent 4xx as final', () => {
    expect(outbox).toMatch(/r\.status_code between 400 and 499 and r\.status_code not in \(408, 429\) then 'failed'/);
    expect(outbox).toMatch(/power\(2, least\(o\.attempts, 6\)\)/);
    expect(outbox).toMatch(/attempts >= 5/);
    expect(outbox).toMatch(/net\._http_response/);
  });

  it('routes the status and results-release triggers through the outbox', () => {
    expect(outbox).toMatch(/create or replace function public\.notify_application_status_change\(\)[\s\S]*perform public\.dispatch_notification\(\s*'notify-application-status'/);
    expect(outbox).toMatch(/create or replace function public\.notify_results_release\(\)[\s\S]*perform public\.dispatch_notification/);
    expect(outbox).not.toMatch(/perform net\.http_post/);
  });

  it('makes the attempt history append-only and free of personal fields', () => {
    const table = outbox.slice(
      outbox.indexOf('create table if not exists public.notification_delivery_attempts'),
      outbox.indexOf('create index if not exists notification_delivery_attempts_source_idx'),
    );
    expect(table).not.toMatch(/\b(email_to|sms_to|email_address|phone|recipient|body|message)\b/i);
    expect(outbox).toMatch(/before update or delete on public\.notification_delivery_attempts/);
    expect(outbox).toMatch(/grant select, insert on public\.notification_delivery_attempts to service_role/);
  });

  it('is mirrored in the reference schema', () => {
    expect(schema).toContain('create or replace function public.dispatch_notification(');
    expect(schema).toContain('create table if not exists public.notification_delivery_attempts');
  });
});

describe('release coverage backfill', () => {
  const scope = read('../supabase/migrations/20261105000000_scope_results_release_reads.sql');

  it('copies only applications that still exist, because the old array has no foreign key', () => {
    const inserts = scope.match(/insert into public\.results_release_applications[\s\S]*?on conflict do nothing;/g) || [];
    expect(inserts).toHaveLength(2);
    inserts.forEach((statement) => {
      expect(statement).toMatch(/join public\.applications a on a\.id = covered\.application_id/);
    });
  });

  it('keeps the reference schema on the same rule', () => {
    const inserts = schema.match(/insert into public\.results_release_applications[\s\S]*?on conflict do nothing;/g) || [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    inserts.forEach((statement) => {
      expect(statement).toMatch(/join public\.applications a on a\.id = covered\.application_id/);
    });
  });
});
