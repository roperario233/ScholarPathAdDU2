import { describe, expect, it } from 'vitest';
import {
  buildDeliveryAttempts,
  channelAttempt,
  classifyDeliveryError,
  inAppAttempt,
  recordDeliveryAttempts,
} from '../supabase/functions/_shared/deliveryAttempts.js';

describe('classifyDeliveryError', () => {
  it.each([
    ['Request timed out after 8000ms', 'timeout'],
    ['The operation was aborted', 'timeout'],
    ['Resend responded 429', 'rate-limited'],
    ['Resend responded 503', 'provider-unavailable'],
    ['Resend responded 422 invalid recipient', 'provider-rejected'],
    ['TypeError: fetch failed', 'network'],
    ['', 'unknown'],
  ])('maps %j to %s', (message, code) => {
    expect(classifyDeliveryError(message)).toBe(code);
  });
});

describe('channel attempts', () => {
  it('records a sent email with the provider id and no address', () => {
    const attempt = channelAttempt({ channel: 'email', wanted: true, result: { ok: true, id: 'email-123' } });
    expect(attempt).toEqual({ channel: 'email', status: 'sent', error_code: null, provider_message_id: 'email-123' });
  });

  it('distinguishes disabled, not-configured and failed channels', () => {
    expect(channelAttempt({ channel: 'sms', wanted: false }).error_code).toBe('disabled');
    expect(channelAttempt({ channel: 'sms', wanted: true, result: { ok: false, skipped: true } }).error_code).toBe('not-configured');
    const failed = channelAttempt({ channel: 'sms', wanted: true, result: { ok: false, error: 'iprogSMS responded 502 for 09171234567' } });
    expect(failed).toMatchObject({ status: 'failed', error_code: 'provider-unavailable' });
  });

  it('never lets a provider error text (which can hold a phone number) reach the row', () => {
    const [row] = buildDeliveryAttempts({
      functionName: 'notify-application-status',
      sourceKey: 'application-status-1-Released',
      userId: 'user-1',
      attempts: [channelAttempt({ channel: 'sms', wanted: true, result: { ok: false, error: 'rejected 09171234567 student@example.com' } })],
    });
    expect(JSON.stringify(row)).not.toMatch(/0917|@example/);
    expect(row.error_code).toBe('provider-rejected');
  });

  it('records the in-app write outcome', () => {
    expect(inAppAttempt({ wanted: true, error: null }).status).toBe('sent');
    expect(inAppAttempt({ wanted: true, error: { message: 'connection reset: network' } })).toMatchObject({ status: 'failed', error_code: 'network' });
    expect(inAppAttempt({ wanted: false }).status).toBe('skipped');
  });

  it('drops anything that is not a known channel or status', () => {
    const rows = buildDeliveryAttempts({
      functionName: 'f',
      sourceKey: 'k',
      attempts: [{ channel: 'pigeon', status: 'sent' }, { channel: 'email', status: 'maybe' }, { channel: 'email', status: 'sent' }],
    });
    expect(rows).toHaveLength(1);
  });
});

describe('recordDeliveryAttempts', () => {
  it('inserts the rows in one statement and reports a failure without throwing', async () => {
    const inserts = [];
    const ok = await recordDeliveryAttempts({ from: (table) => ({ insert: async (rows) => { inserts.push({ table, rows }); return { error: null }; } }) }, [{ channel: 'email' }]);
    expect(ok.error).toBeNull();
    expect(inserts[0].table).toBe('notification_delivery_attempts');

    const failed = await recordDeliveryAttempts({ from: () => ({ insert: async () => { throw new Error('down'); } }) }, [{ channel: 'email' }]);
    expect(failed.error).toBeTruthy();
    expect((await recordDeliveryAttempts({}, [])).error).toBeNull();
  });
});
