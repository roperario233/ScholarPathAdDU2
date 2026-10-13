import { describe, expect, it } from 'vitest';
import {
  formatPhilippineMobile,
  getSmsConfig,
  isSmsEnabledForUser,
  maskPhilippineMobile,
  normalizePhilippineMobile,
  renderApplicationStatusSms,
  renderReminderSms,
  renderTestSms,
} from '../supabase/functions/_shared/sms.js';
import { formatDeadlineLabel } from '../supabase/functions/_shared/email.js';

describe('normalizePhilippineMobile', () => {
  it('canonicalizes the stored and profile formats to 639XXXXXXXXX', () => {
    expect(normalizePhilippineMobile('+63 912 345 6789')).toBe('639123456789');
    expect(normalizePhilippineMobile('09171234567')).toBe('639171234567');
    expect(normalizePhilippineMobile('0912-345-6789')).toBe('639123456789');
    expect(normalizePhilippineMobile('639171234567')).toBe('639171234567');
    expect(normalizePhilippineMobile(' 917 125 4124 ')).toBe('639171254124');
  });

  it('rejects values that are not Philippine mobile numbers', () => {
    expect(normalizePhilippineMobile('')).toBeNull();
    expect(normalizePhilippineMobile(null)).toBeNull();
    expect(normalizePhilippineMobile('not a phone')).toBeNull();
    expect(normalizePhilippineMobile('0822213456')).toBeNull();
    expect(normalizePhilippineMobile('+1 415 555 0100')).toBeNull();
    expect(normalizePhilippineMobile('091712345')).toBeNull();
  });
});

describe('mobile number formatting', () => {
  it('renders the display format used by the profile', () => {
    expect(formatPhilippineMobile('09171234567')).toBe('+63 917 123 4567');
    expect(formatPhilippineMobile('+63 912 345 6789')).toBe('+63 912 345 6789');
  });

  it('masks everything but the last four digits for display', () => {
    expect(maskPhilippineMobile('+63 912 345 6789')).toBe('+63 91•• ••• 6789');
  });

  it('returns null for unusable numbers', () => {
    expect(formatPhilippineMobile('123')).toBeNull();
    expect(maskPhilippineMobile('')).toBeNull();
  });
});

describe('SMS notification preferences', () => {
  it('treats a missing preference as enabled, matching the local defaults', () => {
    expect(isSmsEnabledForUser(undefined)).toBe(true);
    expect(isSmsEnabledForUser({})).toBe(true);
  });

  it('honors an explicit SMS opt-out', () => {
    expect(isSmsEnabledForUser({ smsEnabled: false })).toBe(false);
  });
});

describe('getSmsConfig', () => {
  it('reads the token and optional provider from the Edge Function environment', () => {
    expect(getSmsConfig({ IPROGSMS_API_TOKEN: ' tok ', IPROGSMS_PROVIDER: '2' }))
      .toEqual({ apiToken: 'tok', provider: '2' });
    expect(getSmsConfig({})).toEqual({ apiToken: '', provider: '' });
  });
});

const reminderArgs = {
  title: 'Reminder: "GIA Grant" due in 3 days',
  itemTitle: 'GIA Grant',
  deadline: '2026-10-05',
  daysBefore: 3,
};

describe('renderReminderSms', () => {
  it('uses the in-app notification title and includes the formatted due date', () => {
    const { message } = renderReminderSms(reminderArgs);
    expect(message).toBe('ScholarPath AdDU: Reminder: "GIA Grant" due in 3 days (due 10/05/2026). Sign in to review your deadline calendar.');
  });

  it('generates the heading from the item title when none is supplied', () => {
    const { message } = renderReminderSms({ ...reminderArgs, title: '' });
    expect(message).toContain('Reminder: "GIA Grant" due in 3 days');
  });

  it('uses a singular day label for the 1-day reminder', () => {
    const { message } = renderReminderSms({ ...reminderArgs, daysBefore: 1, title: '' });
    expect(message).toContain('due in 1 day');
  });

  it('stays short enough for one SMS segment and contains no markup', () => {
    const { message } = renderReminderSms(reminderArgs);
    expect(message.length).toBeLessThanOrEqual(160);
    expect(message).not.toMatch(/<[^>]+>/);
  });

  it('tolerates a missing deadline', () => {
    const { message } = renderReminderSms({ ...reminderArgs, deadline: null });
    expect(message).toContain(formatDeadlineLabel(null));
  });
});

describe('renderApplicationStatusSms', () => {
  it('names the scholarship and the new status', () => {
    expect(renderApplicationStatusSms({ scholarshipTitle: 'GIA Grant', status: 'For Verification' }).message)
      .toBe('ScholarPath AdDU: your application for GIA Grant is now For Verification. Sign in to view details.');
  });

  it('falls back when the scholarship title is unknown', () => {
    expect(renderApplicationStatusSms({ scholarshipTitle: '', status: 'Approved' }).message)
      .toContain('your application for a scholarship is now Approved');
  });
});

describe('renderTestSms', () => {
  it('reports the current SMS toggle state', () => {
    expect(renderTestSms({ fullName: 'Juan Cruz', smsEnabled: true }).message).toContain('toggle is ON');
    expect(renderTestSms({ fullName: 'Juan Cruz', smsEnabled: false }).message).toContain('toggle is currently OFF');
  });
});
