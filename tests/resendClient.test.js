import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESEND_MAX_DELAY_MS,
  RESEND_ENDPOINT,
  getResendRetryDelayMs,
  parseRetryAfterMs,
  sendEmail,
} from '../supabase/functions/_shared/resend.js';

const okResponse = (id = 'email-1') => new Response(JSON.stringify({ id }), { status: 200 });

const failureResponse = (status, { message, retryAfter } = {}) => new Response(
  message ? JSON.stringify({ message }) : null,
  {
    status,
    headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
  },
);

const abortingFetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    reject(error);
  });
}));

describe('sendEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    abortingFetch.mockClear();
  });

  it('skips without an API key or recipient instead of throwing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({ apiKey: '', to: 'student@example.org', subject: 'Hi' }))
      .resolves.toEqual({ ok: false, skipped: true, reason: 'RESEND_API_KEY is not configured' });
    await expect(sendEmail({ apiKey: 'key', to: '', subject: 'Hi' }))
      .resolves.toEqual({ ok: false, skipped: true, reason: 'Recipient has no email address on file' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the idempotency key and keeps the existing success shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('email-42'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      apiKey: 'secret-key',
      from: 'ScholarPath <alerts@example.org>',
      to: 'student@example.org',
      subject: 'Status',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'application-status-1-2',
    });

    expect(result).toEqual({ ok: true, skipped: false, id: 'email-42' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.headers['Idempotency-Key']).toBe('application-status-1-2');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'ScholarPath <alerts@example.org>',
      to: ['student@example.org'],
      subject: 'Status',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('does not retry without a stable idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failureResponse(503));
    const sleep = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      sleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      status: 503,
      retryable: true,
      attempts: 1,
    });
  });

  it('retries a retryable failure only when an idempotency key is present', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failureResponse(503))
      .mockResolvedValueOnce(okResponse('email-2'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      idempotencyKey: 'stable-key',
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      random: () => 0.5,
      sleep,
    });

    expect(result).toEqual({ ok: true, skipped: false, id: 'email-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('stable-key');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBe(75);
  });

  it('stops after the bounded retry budget and reports the final retryable failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failureResponse(503));
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      idempotencyKey: 'stable-key',
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 10,
      sleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false, status: 503, retryable: true, attempts: 3 });
  });

  it('does not retry a terminal client error even with an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failureResponse(400, { message: 'Invalid payload' }));
    const sleep = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      idempotencyKey: 'stable-key',
      sleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'Invalid payload',
      retryable: false,
      attempts: 1,
    });
  });

  it('honors Retry-After on a retryable response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failureResponse(429, { retryAfter: '2' }))
      .mockResolvedValueOnce(okResponse('email-3'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      idempotencyKey: 'stable-key',
      baseDelayMs: 1,
      maxDelayMs: 5000,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('bounds a retry after a timeout and reports it as retryable', async () => {
    vi.stubGlobal('fetch', abortingFetch);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      idempotencyKey: 'stable-key',
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 5,
      timeoutMs: 100,
      sleep,
    });

    expect(abortingFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      timeout: true,
      retryable: true,
      attempts: 2,
    });
    expect(result.error).toContain('timed out after 100ms');
  });

  it('times out a request without an idempotency key after one attempt', async () => {
    vi.stubGlobal('fetch', abortingFetch);

    const result = await sendEmail({
      apiKey: 'key',
      to: 'student@example.org',
      subject: 'Hi',
      timeoutMs: 100,
    });

    expect(abortingFetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, timeout: true, retryable: true, attempts: 1 });
  });
});

describe('Resend retry helpers', () => {
  it('parses Retry-After delta seconds and HTTP dates', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfterMs('3', now)).toBe(3000);
    expect(parseRetryAfterMs(new Date(now + 4000).toUTCString(), now)).toBe(4000);
    expect(parseRetryAfterMs('', now)).toBeNull();
    expect(parseRetryAfterMs('not-a-date', now)).toBeNull();
  });

  it('grows exponentially, applies jitter, and stays capped', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 };
    expect(getResendRetryDelayMs({ attempt: 1, ...options })).toBe(100);
    expect(getResendRetryDelayMs({ attempt: 2, ...options })).toBe(200);
    expect(getResendRetryDelayMs({ attempt: 10, ...options })).toBe(1000);
    expect(getResendRetryDelayMs({ attempt: 1, ...options, random: () => 0.5 })).toBe(75);
  });

  it('gives Retry-After priority over the computed delay, capped', () => {
    expect(getResendRetryDelayMs({ attempt: 1, retryAfterMs: 2500, maxDelayMs: 5000 })).toBe(2500);
    expect(getResendRetryDelayMs({ attempt: 1, retryAfterMs: 9000, maxDelayMs: 5000 })).toBe(5000);
    expect(DEFAULT_RESEND_MAX_DELAY_MS).toBe(5000);
  });

  it('caps the first delay by maxDelayMs', () => {
    expect(getResendRetryDelayMs({ attempt: 1, baseDelayMs: 50, maxDelayMs: 60, random: () => 1 })).toBe(50);
    expect(getResendRetryDelayMs({ attempt: 4, baseDelayMs: 50, maxDelayMs: 60, random: () => 1 })).toBe(60);
  });
});
