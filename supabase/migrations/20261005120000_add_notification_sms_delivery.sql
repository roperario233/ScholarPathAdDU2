-- ---------------------------------------------------------------------------
-- SMS notification delivery (iprogSMS).
--
-- Extends the notification delivery ledger for the mobile channel, mirroring
-- how 20260930072510_add_notification_email_delivery.sql added the email
-- columns for Resend:
--
--   * sms_to / sms_status / sms_message_id / sms_error
--       Per-delivery SMS outcome recorded on the same (source_key, user_id)
--       ledger row the Edge Functions already use for at-most-once delivery.
--       sms_status follows the email_status convention: only real sends are
--       recorded as 'sent', while a skipped or failed send stays out of the
--       ledger (or records its reason) so the next scheduled run can retry it.
--
-- The gateway is iprogSMS (https://www.iprogsms.com/api/v1/documentation). The
-- API token lives only in the Edge Function secrets (IPROGSMS_API_TOKEN, with
-- optional IPROGSMS_PROVIDER) and is never exposed to the browser. iprogSMS
-- has no delivery webhooks, so sms_message_id records queue-accept; delivery
-- can be checked poll-only via GET /sms_messages/status.
--
-- Recipient mobile numbers already exist as profiles.phone (text); no schema
-- change is needed there. Format validation happens in the Edge Functions
-- (_shared/sms.js normalizePhilippineMobile) and the profile UI, not as a hard
-- database constraint, since staff numbers and demo values are also stored.
-- ---------------------------------------------------------------------------

alter table notification_email_log
  add column if not exists sms_to text,
  add column if not exists sms_status text check (sms_status in ('sent', 'failed', 'skipped')),
  add column if not exists sms_message_id text,
  add column if not exists sms_error text;
