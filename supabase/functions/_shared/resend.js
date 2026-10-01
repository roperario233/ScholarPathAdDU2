/**
 * Minimal Resend client shared by the notification Edge Functions.
 *
 * Dependency-free (plain fetch, no SDK) so it can be imported by Deno and the
 * vitest suite alike. The API key is only ever read from the Edge Function
 * environment — it must never be shipped to the browser bundle.
 */
import { resolveFromAddress } from './email.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const getResendConfig = (env = {}) => ({
  apiKey: String(env.RESEND_API_KEY ?? '').trim(),
  from: resolveFromAddress(env),
});

/**
 * Sends one email through Resend.
 *
 * Returns a discriminated result instead of throwing so callers can record a
 * failure in the delivery ledger rather than losing the whole run.
 *
 * @returns {Promise<{ok: boolean, skipped: boolean, reason?: string, id?: string|null, error?: string, status?: number}>}
 */
export const sendEmail = async ({ apiKey, from, to, subject, html, text, idempotencyKey }) => {
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY is not configured' };
  }
  if (!to) {
    return { ok: false, skipped: true, reason: 'Recipient has no email address on file' };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        status: response.status,
        error: payload?.message || `Resend responded with status ${response.status}`,
      };
    }

    return { ok: true, skipped: false, id: payload?.id ?? null };
  } catch (error) {
    return { ok: false, skipped: false, error: error?.message || 'Unable to reach Resend' };
  }
};
