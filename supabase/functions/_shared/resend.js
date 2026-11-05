/**
 * Minimal Resend client shared by the notification Edge Functions.
 *
 * Dependency-free (plain fetch, no SDK) so it can be imported by Deno and the
 * vitest suite alike. The API key is only ever read from the Edge Function
 * environment — it must never be shipped to the browser bundle.
 */
import { resolveFromAddress } from './email.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const DEFAULT_RESEND_TIMEOUT_MS = 10_000;
export const MIN_RESEND_TIMEOUT_MS = 100;
export const MAX_RESEND_TIMEOUT_MS = 30_000;
export const DEFAULT_RESEND_MAX_RETRIES = 2;
export const MAX_RESEND_RETRIES = 4;
export const DEFAULT_RESEND_BASE_DELAY_MS = 500;
export const DEFAULT_RESEND_MAX_DELAY_MS = 5_000;

const RETRYABLE_RESEND_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export const getResendConfig = (env = {}) => ({
  apiKey: String(env.RESEND_API_KEY ?? '').trim(),
  from: resolveFromAddress(env),
});

const clampNonNegative = (value, fallback, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(max, Math.round(parsed));
};

/** Bounds a requested timeout so a caller cannot disable the guard or wait forever. */
export const clampResendTimeoutMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RESEND_TIMEOUT_MS;
  return Math.min(MAX_RESEND_TIMEOUT_MS, Math.max(MIN_RESEND_TIMEOUT_MS, Math.round(parsed)));
};

const clampRetryCount = (value) => clampNonNegative(value, DEFAULT_RESEND_MAX_RETRIES, MAX_RESEND_RETRIES);

/** Transient HTTP statuses worth retrying when the request is idempotent. */
export const isRetryableResendStatus = (status) => RETRYABLE_RESEND_STATUSES.has(Number(status));

/**
 * Parses a Retry-After header value (delta-seconds or an HTTP date) into a
 * delay in milliseconds. Returns null when the header is absent or unusable.
 */
export const parseRetryAfterMs = (value, now = Date.now()) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }

  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
};

/**
 * Bounded exponential backoff with optional equal jitter. A Retry-After hint
 * wins over the computed delay; either way the delay is capped.
 */
export const getResendRetryDelayMs = ({
  attempt,
  retryAfterMs = null,
  baseDelayMs = DEFAULT_RESEND_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_RESEND_MAX_DELAY_MS,
  random = Math.random,
} = {}) => {
  const max = clampNonNegative(maxDelayMs, DEFAULT_RESEND_MAX_DELAY_MS, 60_000);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(max, Math.round(retryAfterMs));
  }

  const base = clampNonNegative(baseDelayMs, DEFAULT_RESEND_BASE_DELAY_MS, 60_000);
  const step = Math.max(1, Number(attempt) || 1);
  const exponential = Math.min(max, base * 2 ** (step - 1));
  const sample = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.min(max, Math.round(exponential * (0.5 + sample * 0.5)));
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postEmailOnce = async ({ apiKey, from, to, subject, html, text, idempotencyKey, timeoutMs }) => {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const controller = new AbortController();
  const timeoutMessage = `Resend request timed out after ${timeoutMs}ms`;
  const timeoutError = new Error(timeoutMessage);
  timeoutError.name = 'TimeoutError';
  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    let payload = null;
    try {
      payload = await Promise.race([response.json(), timeoutPromise]);
    } catch (error) {
      if (timedOut || error === timeoutError) throw timeoutError;
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        status: response.status,
        retryable: isRetryableResendStatus(response.status),
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after')),
        error: payload?.message || `Resend responded with status ${response.status}`,
      };
    }

    return { ok: true, skipped: false, id: payload?.id ?? null };
  } catch (error) {
    const timeout = timedOut || error === timeoutError || error?.name === 'AbortError';
    return {
      ok: false,
      skipped: false,
      retryable: true,
      timeout,
      error: timeout ? timeoutMessage : error?.message || 'Unable to reach Resend',
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Sends one email through Resend.
 *
 * Returns a discriminated result instead of throwing so callers can record a
 * failure in the delivery ledger rather than losing the whole run.
 *
 * Reliability is deliberately conservative:
 *   * Every attempt is bounded by `timeoutMs` (default 10s, clamped 100ms–30s).
 *   * Retries happen only when a stable `idempotencyKey` is supplied, so a
 *     retried request can never send the same email twice. Without a key the
 *     request is attempted once, exactly as before.
 *   * Retryable failures back off exponentially with jitter, honoring a
 *     Retry-After hint and capping the delay. Terminal 4xx failures return
 *     immediately.
 *   * Failures carry `retryable` and `attempts`; skipped and success shapes are
 *     unchanged so existing ledger readers keep working.
 *
 * @returns {Promise<{ok: boolean, skipped: boolean, reason?: string, id?: string|null, error?: string, status?: number, retryable?: boolean, attempts?: number, timeout?: boolean}>}
 */
export const sendEmail = async ({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
  idempotencyKey,
  timeoutMs,
  maxRetries,
  baseDelayMs,
  maxDelayMs,
  sleep = defaultSleep,
  random = Math.random,
}) => {
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY is not configured' };
  }
  if (!to) {
    return { ok: false, skipped: true, reason: 'Recipient has no email address on file' };
  }

  const boundedTimeoutMs = clampResendTimeoutMs(timeoutMs);
  const retries = idempotencyKey ? clampRetryCount(maxRetries) : 0;
  const allowedAttempts = retries + 1;

  let attempts = 0;
  let failure = null;

  for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
    attempts = attempt;
    const outcome = await postEmailOnce({
      apiKey,
      from,
      to,
      subject,
      html,
      text,
      idempotencyKey,
      timeoutMs: boundedTimeoutMs,
    });

    if (outcome.ok) {
      return { ok: true, skipped: false, id: outcome.id };
    }

    failure = outcome;
    if (!outcome.retryable || attempt >= allowedAttempts) break;

    const delay = getResendRetryDelayMs({
      attempt,
      retryAfterMs: outcome.retryAfterMs,
      baseDelayMs,
      maxDelayMs,
      random,
    });
    if (delay > 0) await sleep(delay);
  }

  const { retryAfterMs: _retryAfterMs, ...reported } = failure;
  return { ...reported, attempts };
};
