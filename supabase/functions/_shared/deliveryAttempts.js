/**
 * Append-only record of what each Edge Function attempted per channel
 * (notification_delivery_attempts, 20261105000006).
 *
 * The delivery ledger (notification_email_log) keeps the latest state per
 * recipient and channel; this keeps the history, so "why did the second email not
 * go out" can be answered after the fact. A row holds a status and a short code
 * only. It never carries an address, a phone number, a message body or a
 * provider's error text, all of which can name a person.
 *
 * Dependency-free plain JavaScript so Deno, vitest and the browser bundle can all
 * import it.
 */

export const ATTEMPT_CHANNELS = ['in-app', 'email', 'sms'];
export const ATTEMPT_STATUSES = ['sent', 'skipped', 'failed'];

// Reduces a provider or transport failure to one of a fixed set of codes.
export const classifyDeliveryError = (error) => {
  const text = String(error?.message ?? error ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('timeout') || text.includes('timed out') || text.includes('abort')) return 'timeout';
  if (text.includes('429') || text.includes('rate limit') || text.includes('too many')) return 'rate-limited';
  if (/\b5\d\d\b/.test(text) || text.includes('unavailable') || text.includes('bad gateway')) return 'provider-unavailable';
  if (/\b4\d\d\b/.test(text) || text.includes('invalid') || text.includes('rejected') || text.includes('unauthorized')) return 'provider-rejected';
  if (text.includes('network') || text.includes('fetch') || text.includes('econn') || text.includes('dns')) return 'network';
  return 'unknown';
};

// `wanted` is whether the person's preferences asked for this channel at all.
// `result` is the channel's outcome: { ok, skipped, id | messageId, error }.
export const channelAttempt = ({ channel, wanted, result }) => {
  if (!wanted) return { channel, status: 'skipped', error_code: 'disabled', provider_message_id: null };
  if (result?.ok) {
    return { channel, status: 'sent', error_code: null, provider_message_id: result.id ?? result.messageId ?? null };
  }
  if (result?.skipped) return { channel, status: 'skipped', error_code: 'not-configured', provider_message_id: null };
  return { channel, status: 'failed', error_code: classifyDeliveryError(result?.error ?? result?.reason), provider_message_id: null };
};

// The in-app write is an upsert whose only result is an error or none.
export const inAppAttempt = ({ wanted, error }) => {
  if (!wanted) return { channel: 'in-app', status: 'skipped', error_code: 'disabled', provider_message_id: null };
  if (error) return { channel: 'in-app', status: 'failed', error_code: classifyDeliveryError(error), provider_message_id: null };
  return { channel: 'in-app', status: 'sent', error_code: null, provider_message_id: null };
};

export const buildDeliveryAttempts = ({ functionName, sourceKey, userId = null, attempts = [] }) => attempts
  .filter((attempt) => attempt && ATTEMPT_CHANNELS.includes(attempt.channel) && ATTEMPT_STATUSES.includes(attempt.status))
  .map((attempt) => ({
    function_name: functionName,
    source_key: sourceKey,
    user_id: userId,
    channel: attempt.channel,
    status: attempt.status,
    error_code: attempt.error_code ?? null,
    provider_message_id: attempt.provider_message_id ?? null,
  }));

// Inserts the rows. A failure here must never change what the function reports
// to its caller (the notification itself already happened or did not), so the
// outcome is returned for logging and otherwise ignored.
export const recordDeliveryAttempts = async (supabase, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return { error: null };
  try {
    const { error } = await supabase.from('notification_delivery_attempts').insert(rows);
    return { error: error ?? null };
  } catch (error) {
    return { error };
  }
};
