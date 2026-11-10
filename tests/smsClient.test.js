import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  IPROGSMS_ENDPOINT,
  sendSms,
} from '../supabase/functions/_shared/sms.js';

const abortingFetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    reject(error);
  });
}));

describe('sendSms', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    abortingFetch.mockClear();
  });

  it('skips without a token, recipient, or message instead of throwing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSms({ apiToken: '', phoneNumber: '639171234567', message: 'hi' }))
      .resolves.toMatchObject({ ok: false, skipped: true, reason: 'IPROGSMS_API_TOKEN is not configured' });
    await expect(sendSms({ apiToken: 'tok', phoneNumber: '', message: 'hi' }))
      .resolves.toMatchObject({ ok: false, skipped: true, reason: 'Recipient has no mobile number on file' });
    await expect(sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: '' }))
      .resolves.toMatchObject({ ok: false, skipped: true, reason: 'Message content is empty' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the token in the JSON body, never the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 200, message: 'queued', message_id: 'iSms-XHYBk' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({ apiToken: 'secret-token', phoneNumber: '639171234567', message: 'Hello', provider: '0' });

    expect(result).toEqual({ ok: true, skipped: false, messageId: 'iSms-XHYBk' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(IPROGSMS_ENDPOINT);
    expect(JSON.parse(init.body)).toEqual({
      api_token: 'secret-token',
      phone_number: '639171234567',
      message: 'Hello',
      sms_provider: 0,
    });
  });

  it('coerces the gateway error payloads into readable strings', async () => {
    // iprogSMS sometimes returns its error text as an array, e.g. the
    // Smart/TNT shared-sender rejection.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 402, message: ['Smart/TNT networks do not accept shared sender names.', 'Get your own sender name approved.'] }),
      { status: 402 },
    )));

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });
    expect(result).toMatchObject({ ok: false, skipped: false, error: 'Smart/TNT networks do not accept shared sender names.; Get your own sender name approved.' });
  });

  it('treats an iprogSMS error payload as a failed send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 402, message: 'Insufficient load balance' }),
      { status: 402 },
    )));

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });
    expect(result).toMatchObject({ ok: false, skipped: false, status: 402, error: 'Insufficient load balance' });
  });

  it('rejects a 200 response that did not queue the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 422, message: 'Invalid phone number' }),
      { status: 200 },
    )));

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });
    expect(result).toMatchObject({ ok: false, skipped: false, error: 'Invalid phone number' });
  });

  it('reports network failures without throwing and marks the result ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      error: 'connection reset',
      ambiguous: true,
      retryable: false,
      attempts: 1,
    });
  });

  it('times out and reports an ambiguous result without retrying', async () => {
    vi.stubGlobal('fetch', abortingFetch);

    const result = await sendSms({
      apiToken: 'tok',
      phoneNumber: '639171234567',
      message: 'Hello',
      timeoutMs: 100,
    });

    expect(abortingFetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      timeout: true,
      ambiguous: true,
      retryable: false,
      attempts: 1,
    });
    expect(result.error).toContain('timed out after 100ms');
  });

  it('never retries a 5xx even though the outcome is ambiguous', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 503, message: 'Gateway unavailable' }),
      { status: 503 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      ambiguous: true,
      retryable: false,
      attempts: 1,
    });
  });

  it('marks an explicit 429 as retryable for a later manual attempt but does not retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 429, message: 'Rate limited' }),
      { status: 429 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms({ apiToken: 'tok', phoneNumber: '639171234567', message: 'Hello' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      status: 429,
      ambiguous: false,
      retryable: true,
      attempts: 1,
    });
  });
});
