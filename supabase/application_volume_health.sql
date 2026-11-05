-- Read-only operational snapshot for the application-volume rollout.
-- Run in the Supabase SQL editor or another read-only operator session; never
-- select pg_net response bodies because they can contain notification payloads.

select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_rows,
  seq_scan,
  idx_scan,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
    'applications', 'application_documents', 'application_status_log', 'documents',
    'notifications', 'notification_email_log', 'results_releases',
    'results_release_applications', 'application_import_batches'
  )
order by n_live_tup desc;

select
  indexrelname as index_name,
  relname as table_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
  and relname in ('applications', 'documents', 'notifications', 'notification_email_log')
order by relname, indexrelname;

select
  queryid,
  calls,
  round(mean_exec_time::numeric, 2) as mean_ms,
  round(max_exec_time::numeric, 2) as max_ms,
  rows,
  left(query, 300) as normalized_query
from pg_stat_statements
where query ~* '(applications|application_documents|application_status_log|documents|notifications|results_releases)'
order by total_exec_time desc
limit 25;

select state, wait_event_type, wait_event, count(*) as connections
from pg_stat_activity
where backend_type = 'client backend'
group by state, wait_event_type, wait_event
order by connections desc;

select
  date_trunc('minute', created) as minute,
  status_code,
  timed_out,
  count(*) as requests
from net._http_response
where created >= now() - interval '60 minutes'
  and (status_code >= 400 or timed_out)
group by 1, 2, 3
order by 1 desc, 2;
