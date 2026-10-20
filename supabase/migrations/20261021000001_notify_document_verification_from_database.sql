-- ---------------------------------------------------------------------------
-- Notify the student when a Document Vault file is verified or rejected.
--
-- The Admissions Office's decision used to produce only a notification in the
-- reviewer's own browser, so the student never learned that a file was
-- rejected. This AFTER UPDATE trigger calls the notify-document-verification
-- Edge Function from the database (pg_net), exactly like
-- 20261014000003_notify_application_status_from_database.sql. The function
-- re-reads the document, writes the student's in-app row, and for a rejection
-- also emails and texts the reason. It dedupes on
-- `document-verification-<documentId>-<status>-<decidedAtEpoch>`, so the
-- browser's own call after the write is a harmless retry.
--
-- Setup before applying:
--   1. Replace <project-ref> with the deployed project ref.
--   2. Replace <REMINDER_CRON_SECRET> with the same value set as the
--      REMINDER_CRON_SECRET Edge Function secret (the one already used in
--      20261014000003).
--   3. Deploy `notify-document-verification` with verify_jwt disabled:
--        supabase functions deploy notify-document-verification --no-verify-jwt
--
-- pg_net queues the request, so the verification write is never blocked.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

create or replace function public.notify_document_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  if new.verification_status is distinct from old.verification_status
    and new.verification_status in ('Verified', 'Rejected') then
    perform net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/notify-document-verification',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <REMINDER_CRON_SECRET>',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('documentId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_document_verification_change on public.documents;
create trigger notify_document_verification_change
  after update on public.documents
  for each row execute function public.notify_document_verification_change();
