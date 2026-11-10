import { describe, expect, it } from 'vitest';
import {
  DIRECT_SEND_CAP,
  buildRecipientPlan,
  QUIET_PREFERENCES,
  TEST_EMAIL_DOMAIN,
  evaluateRelease,
  isQuietProfile,
  summarizeAttempts,
  summarizeOutbox,
  testEmail,
} from '../scripts/loadtest-release.mjs';

const at = (seconds) => new Date(Date.UTC(2026, 10, 6, 3, 0, seconds)).toISOString();

const outboxRows = (count, { direct = DIRECT_SEND_CAP } = {}) => Array.from({ length: count }, (_, index) => ({
  status: 'sent',
  attempts: 1,
  created_at: at(0),
  dispatched_at: index < direct ? at(0) : at(30 + index),
  completed_at: at(90 + index),
}));

const quietAttempts = (count) => Array.from({ length: count }, (_, index) => [
  { channel: 'in-app', status: 'sent', source_key: `k${index}` },
  { channel: 'email', status: 'skipped', source_key: `k${index}` },
  { channel: 'sms', status: 'skipped', source_key: `k${index}` },
]).flat();

const goodRun = (count = 120) => ({
  seeded: count,
  released: count,
  replay: { replayed: true, count },
  outbox: summarizeOutbox(outboxRows(count)),
  attempts: summarizeAttempts(quietAttempts(count)),
  inAppReleasedNotices: count,
});

describe('test recipients', () => {
  it('uses a reserved, undeliverable domain', () => {
    expect(TEST_EMAIL_DOMAIN.endsWith('.invalid')).toBe(true);
    expect(testEmail('student', 7)).toBe('loadtest-student-007@loadtest.scholarpath.invalid');
    expect(testEmail('admin')).toBe('loadtest-admin@loadtest.scholarpath.invalid');
  });

  it('counts a profile as quiet only when email and SMS are off and there is no phone number', () => {
    expect(isQuietProfile({ notification_preferences: QUIET_PREFERENCES, phone: null })).toBe(true);
    expect(isQuietProfile({ notification_preferences: { ...QUIET_PREFERENCES, smsEnabled: true }, phone: null })).toBe(false);
    expect(isQuietProfile({ notification_preferences: { ...QUIET_PREFERENCES, emailEnabled: true }, phone: null })).toBe(false);
    expect(isQuietProfile({ notification_preferences: QUIET_PREFERENCES, phone: '09171234567' })).toBe(false);
    expect(isQuietProfile({ notification_preferences: {}, phone: null })).toBe(false);
    expect(isQuietProfile(null)).toBe(false);
  });
});

describe('summaries', () => {
  it('separates what went out at once from what waited for the worker', () => {
    const summary = summarizeOutbox(outboxRows(120));
    expect(summary.total).toBe(120);
    expect(summary.sentImmediately).toBe(DIRECT_SEND_CAP);
    expect(summary.byStatus).toEqual({ sent: 120 });
    expect(summary.drainSeconds).toBeGreaterThan(0);
  });

  it('counts only email and SMS that actually went out as external sends', () => {
    const summary = summarizeAttempts([
      { channel: 'in-app', status: 'sent' },
      { channel: 'sms', status: 'skipped' },
      { channel: 'email', status: 'sent' },
      { channel: 'sms', status: 'failed' },
    ]);
    expect(summary.externalSent).toBe(1);
    expect(summary.failed).toBe(1);
  });
});

describe('verdict', () => {
  it('passes a clean 120-case run', () => {
    const verdict = evaluateRelease(goodRun());
    expect(verdict.checks.filter((check) => !check.ok)).toEqual([]);
    expect(verdict.passed).toBe(true);
  });

  it('fails when a row is still pending, so the run is not called settled early', () => {
    const run = goodRun();
    run.outbox = summarizeOutbox([...outboxRows(119), { status: 'pending', attempts: 0, created_at: at(0) }]);
    expect(evaluateRelease(run).passed).toBe(false);
  });

  it('fails if the cap on simultaneous sends was exceeded', () => {
    const run = goodRun();
    run.outbox = summarizeOutbox(outboxRows(120, { direct: 120 }));
    const verdict = evaluateRelease(run);
    expect(verdict.checks.find((check) => check.name.includes('direct-send cap')).ok).toBe(false);
  });

  it('fails loudly if any email or SMS went out', () => {
    const run = goodRun();
    run.attempts = summarizeAttempts([...quietAttempts(120), { channel: 'sms', status: 'sent' }]);
    const verdict = evaluateRelease(run);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'Only the expected email and SMS were sent').ok).toBe(false);
  });

  it('fails if the repeated request released again instead of replaying', () => {
    const run = goodRun();
    run.replay = { replayed: false, count: 120 };
    expect(evaluateRelease(run).passed).toBe(false);
  });

  it('fails if a released student has no in-app notice', () => {
    const run = goodRun();
    run.inAppReleasedNotices = 119;
    expect(evaluateRelease(run).passed).toBe(false);
  });
});

describe('one real recipient', () => {
  it('turns on only the channels you give it', () => {
    expect(buildRecipientPlan({})).toMatchObject({ expectedExternal: { email: 0, sms: 0 }, preferences: { emailEnabled: false, smsEnabled: false } });
    expect(buildRecipientPlan({ email: 'me@gmail.com' })).toMatchObject({ expectedExternal: { email: 1, sms: 0 }, preferences: { emailEnabled: true, smsEnabled: false } });
    expect(buildRecipientPlan({ phone: '09171234567' })).toMatchObject({ expectedExternal: { email: 0, sms: 1 }, preferences: { emailEnabled: false, smsEnabled: true } });
    expect(buildRecipientPlan({ email: 'me@gmail.com', phone: '+63 917 123 4567' }).expectedExternal).toEqual({ email: 1, sms: 1 });
  });

  it('rejects an address or number that could not be a real one, before anything is created', () => {
    expect(() => buildRecipientPlan({ email: 'not-an-email' })).toThrow('valid email');
    expect(() => buildRecipientPlan({ email: `x@${TEST_EMAIL_DOMAIN}` })).toThrow('real address');
    expect(() => buildRecipientPlan({ phone: '12345' })).toThrow('Philippine mobile');
  });

  it('expects exactly one of each message, so a missing delivery fails the run too', () => {
    const run = goodRun();
    run.expectedExternal = { email: 1, sms: 1 };
    run.attempts = summarizeAttempts([...quietAttempts(119), { channel: 'in-app', status: 'sent' }, { channel: 'email', status: 'sent' }, { channel: 'sms', status: 'sent' }]);
    expect(evaluateRelease(run).checks.find((check) => check.name.startsWith('Only the expected')).ok).toBe(true);

    run.attempts = summarizeAttempts([...quietAttempts(119), { channel: 'email', status: 'sent' }]);
    expect(evaluateRelease(run).checks.find((check) => check.name.startsWith('Only the expected')).ok).toBe(false);
  });
});
