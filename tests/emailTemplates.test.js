import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FROM,
  REMINDER_OFFSET_KEYS,
  describeApplicationStatusUpdate,
  isEmailEnabledForUser,
  isInAppEnabledForUser,
  isReminderEnabledForUser,
  renderApplicationStatusEmail,
  renderDocumentRejectionEmail,
  renderReminderEmail,
  renderTestEmail,
  resolveFromAddress,
  resolveSiteUrl,
} from '../supabase/functions/_shared/email.js';
import { manilaDateKey } from '../supabase/functions/_shared/reminders.js';

describe('resolveFromAddress', () => {
  it('composes the display name and address from separate secrets', () => {
    expect(resolveFromAddress({ RESEND_FROM_EMAIL: 'alerts@scholarpath.site', RESEND_FROM_NAME: 'ScholarPath AdDU' }))
      .toBe('ScholarPath AdDU <alerts@scholarpath.site>');
  });

  it('falls back to the bare address when no display name is set', () => {
    expect(resolveFromAddress({ RESEND_FROM_EMAIL: 'alerts@scholarpath.site' })).toBe('alerts@scholarpath.site');
  });

  it('falls back to the Resend shared test sender when unconfigured', () => {
    expect(resolveFromAddress({})).toBe(DEFAULT_FROM);
    expect(resolveFromAddress()).toBe(DEFAULT_FROM);
  });
});

describe('resolveSiteUrl', () => {
  it('normalizes the configured site URL to a trailing slash', () => {
    expect(resolveSiteUrl({ APP_SITE_URL: 'https://example.org' })).toBe('https://example.org/');
    expect(resolveSiteUrl({ APP_SITE_URL: 'https://example.org/' })).toBe('https://example.org/');
  });

  it('falls back to the deployed prototype origin', () => {
    expect(resolveSiteUrl({})).toBe('https://scholarpath-addu.vercel.app/');
  });
});

describe('notification preferences', () => {
  it('treats a missing preference as enabled, matching the local defaults', () => {
    expect(isEmailEnabledForUser(undefined)).toBe(true);
    expect(isEmailEnabledForUser({})).toBe(true);
  });

  it('honors an explicit email opt-out', () => {
    expect(isEmailEnabledForUser({ emailEnabled: false })).toBe(false);
  });

  it('defaults in-app notifications to enabled and honors an explicit opt-out', () => {
    expect(isInAppEnabledForUser(undefined)).toBe(true);
    expect(isInAppEnabledForUser({})).toBe(true);
    expect(isInAppEnabledForUser({ inAppEnabled: false })).toBe(false);
  });

  it('maps each reminder offset to its notificationPreferences key', () => {
    expect(REMINDER_OFFSET_KEYS).toEqual({ 7: 'oneWeekBefore', 3: 'threeDaysBefore', 1: 'dayBefore' });
  });

  it('honors disabled reminder timings and rejects unknown offsets', () => {
    expect(isReminderEnabledForUser({}, 7)).toBe(true);
    expect(isReminderEnabledForUser({ deadlineReminders: { oneWeekBefore: false } }, 7)).toBe(false);
    expect(isReminderEnabledForUser({ deadlineReminders: { oneWeekBefore: false } }, 3)).toBe(true);
    expect(isReminderEnabledForUser({}, 5)).toBe(false);
  });
});

describe('manilaDateKey', () => {
  it('resolves to the next day once Manila has crossed midnight', () => {
    // 23:00 UTC is already 07:00 the next day in Manila (UTC+8), which is when
    // the scheduled job fires.
    expect(manilaDateKey(new Date('2026-09-30T23:00:00Z'))).toBe('2026-10-01');
    // 15:59 UTC is still 23:59 the same day in Manila.
    expect(manilaDateKey(new Date('2026-09-30T15:59:00Z'))).toBe('2026-09-30');
  });
});

const reminderArgs = {
  title: 'Reminder: "GIA Grant" due in 3 days',
  itemTitle: 'GIA Grant',
  deadline: '2026-10-05',
  daysBefore: 3,
  siteUrl: 'https://scholarpath-addu.vercel.app/',
};

describe('renderReminderEmail', () => {
  it('uses the in-app notification title verbatim as the subject', () => {
    expect(renderReminderEmail(reminderArgs).subject).toBe(reminderArgs.title);
  });

  it('spans every single-cell row across the two-column card so it never collapses', () => {
    const { html } = renderReminderEmail(reminderArgs);
    // renderDetailRows() defines a two-column grid, so the header, heading, intro,
    // CTA and footer rows must colspan both columns or they shrink into the left column.
    expect(html).toMatch(/<td class="sp-header" colspan="2"/);
    expect(html).toMatch(/<td class="sp-heading-cell" colspan="2"/);
    expect(html).toMatch(/<td class="sp-intro-cell" colspan="2"/);
    expect(html).toMatch(/<td class="sp-cta-cell" colspan="2"/);
    expect(html).toMatch(/<td class="sp-footer" colspan="2"/);
  });

  it('declares light and dark color schemes with a dark-mode block', () => {
    const { html } = renderReminderEmail(reminderArgs);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('.sp-card');
  });

  it('renders Resend-compatible table HTML with no script, button or div elements', () => {
    const { html } = renderReminderEmail(reminderArgs);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<table');
    expect(html).toContain('cellpadding="0"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<div');
  });

  it('never uses CSS shorthand for spacing', () => {
    const { html } = renderReminderEmail(reminderArgs);
    expect(html).not.toMatch(/style="[^"]*[^-]padding:/);
    expect(html).not.toMatch(/style="[^"]*[^-]margin:/);
  });

  it('includes the deadline, remaining time and a plain-text alternative', () => {
    const { html, text } = renderReminderEmail(reminderArgs);
    expect(html).toContain('GIA Grant');
    expect(html).toContain('10/05/2026');
    expect(html).toContain('3 days');
    expect(text).toContain('Due date: 10/05/2026');
    expect(text).toContain('Open ScholarPath AdDU: https://scholarpath-addu.vercel.app/?view=calendar');
  });

  it('uses a singular day label for the 1-day reminder', () => {
    const { html, text } = renderReminderEmail({ ...reminderArgs, daysBefore: 1 });
    expect(html).toContain('1 day<');
    expect(text).toContain('Time remaining: 1 day');
  });

  it('escapes untrusted scholarship titles', () => {
    const { html } = renderReminderEmail({ ...reminderArgs, itemTitle: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('generates a subject when none is supplied', () => {
    expect(renderReminderEmail({ ...reminderArgs, title: '' }).subject)
      .toBe('Reminder: "GIA Grant" due in 3 days');
  });

  it('tolerates a missing deadline', () => {
    expect(renderReminderEmail({ ...reminderArgs, deadline: null }).html).toContain('No deadline recorded');
  });
});

describe('renderApplicationStatusEmail', () => {
  it('renders the scholarship and the new status', () => {
    const { subject, html, text } = renderApplicationStatusEmail({
      subject: 'Application status: For Verification',
      body: 'Your application status was updated to For Verification.',
      scholarshipTitle: 'GIA Grant',
      status: 'For Verification',
      siteUrl: 'https://example.org/',
    });
    expect(subject).toBe('Application status: For Verification');
    expect(html).toContain('GIA Grant');
    expect(html).toContain('For Verification');
    expect(text).toContain('View your applications: https://example.org/?view=applications');
  });

  it('shows the endorsement phase label for the stored Endorsed status', () => {
    const { subject, html, text } = renderApplicationStatusEmail({
      scholarshipTitle: 'GIA Grant',
      status: 'Endorsed',
      siteUrl: 'https://example.org/',
    });
    expect(subject).toBe('Application update: Endorsement');
    expect(html).toContain('Endorsement');
    expect(text).toContain('New status: Endorsement');
  });

  it('names the hand-off stage as awaiting endorsement', () => {
    const { subject, text } = renderApplicationStatusEmail({
      scholarshipTitle: 'GIA Grant',
      status: 'For Endorsement',
      siteUrl: 'https://example.org/',
    });
    expect(subject).toBe('Application update: Awaiting Endorsement');
    expect(text).toContain('New status: Awaiting Endorsement');
  });
});

describe('describeApplicationStatusUpdate', () => {
  it('tells the applicant their documents are under verification', () => {
    const message = describeApplicationStatusUpdate('For Verification', 'the Admissions Office');
    expect(message).toContain('Admissions Office for verification');
    expect(message).toContain('replacement');
  });

  it('keeps the generic next-step copy for other statuses', () => {
    expect(describeApplicationStatusUpdate('Interview', 'the Admissions Office'))
      .toBe('Your application status was updated to Interview through the Admissions Office. Sign in to review the next steps.');
  });

  it('describes the endorsement phase for the stored Endorsed status', () => {
    const message = describeApplicationStatusUpdate('Endorsed', 'the Department Chair');
    expect(message).toContain('endorsement phase');
    expect(message).toContain('interview');
  });

  it('describes the hand-off to the Department Chair for For Endorsement', () => {
    const message = describeApplicationStatusUpdate('For Endorsement', 'the Admissions Office');
    expect(message).toContain('Department Chair for endorsement');
    expect(message).toContain('No action');
  });
});

describe('renderDocumentRejectionEmail', () => {
  it('carries the document, the escaped reason, and the applications that use it', () => {
    const { subject, html, text } = renderDocumentRejectionEmail({
      documentTitle: 'Income Tax Return',
      reason: 'Wrong document type — upload the <BIR 2316>',
      scholarshipTitles: ['GIA Grant', 'Student Assistant Program'],
      siteUrl: 'https://example.org/',
    });
    expect(subject).toBe('Income Tax Return needs a replacement');
    expect(html).toContain('&lt;BIR 2316&gt;');
    expect(html).not.toContain('<BIR 2316>');
    expect(text).toContain('Reason: Wrong document type — upload the <BIR 2316>');
    expect(text).toContain('Applications: GIA Grant, Student Assistant Program');
    expect(text).toContain('replace the file');
  });

  it('points to the Document Vault when no application uses the file', () => {
    const { text } = renderDocumentRejectionEmail({ documentTitle: 'Certificate', reason: 'Unreadable', siteUrl: 'https://example.org/' });
    expect(text).not.toContain('Application:');
    expect(text).toContain('Upload a corrected file to your Document Vault.');
  });
});

describe('renderTestEmail', () => {
  it('reports the current email toggle state', () => {
    const enabled = renderTestEmail({ fullName: 'Juan Cruz', emailEnabled: true, siteUrl: 'https://example.org/' });
    expect(enabled.html).toContain('Enabled');

    const disabled = renderTestEmail({ fullName: 'Juan Cruz', emailEnabled: false, siteUrl: 'https://example.org/' });
    expect(disabled.html).toContain('Disabled');
    expect(disabled.text).toContain('Email notifications: Disabled');
  });
});
