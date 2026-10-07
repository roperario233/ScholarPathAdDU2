/**
 * Shared email rendering and delivery-preference helpers.
 *
 * Like `_shared/reminders.js`, this module is intentionally dependency-free
 * plain JavaScript so it can be imported by both the Supabase Edge Functions
 * (Deno) and the vitest test suite. It renders Resend-compatible HTML (table
 * layouts, inline longhand styles, no images, no JavaScript) alongside a
 * plain-text alternative.
 */

// Ateneo blue visual identity, matching the app's theme primitives.
const PRIMARY = '#0b2d5c';
const ACCENT = '#1f5fd6';
const SURFACE = '#f4f7fb';
const BORDER = '#d7e0ee';
const TEXT = '#11213a';
const MUTED = '#4d6383';
const FONT = 'Arial, Helvetica, sans-serif';

export const DEFAULT_FROM = 'ScholarPath AdDU <onboarding@resend.dev>';
export const DEFAULT_SITE_URL = 'https://scholarpath-addu.vercel.app/';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Maps a reminder offset in days to the matching notificationPreferences key
// used by the client (src/lib/appState.js) and SettingsView.
export const REMINDER_OFFSET_KEYS = {
  7: 'oneWeekBefore',
  3: 'threeDaysBefore',
  1: 'dayBefore',
};

const pad = (part) => String(part).padStart(2, '0');

/**
 * Resolves the Resend "from" header from the Edge Function environment.
 * Kept as two secrets (name + address) so the value never needs shell quoting
 * around angle brackets.
 */
export const resolveFromAddress = (env = {}) => {
  const email = String(env.RESEND_FROM_EMAIL ?? '').trim();
  const name = String(env.RESEND_FROM_NAME ?? '').trim();
  if (!email) return DEFAULT_FROM;
  return name ? `${name} <${email}>` : email;
};

export const resolveSiteUrl = (env = {}) => {
  const configured = String(env.APP_SITE_URL ?? '').trim();
  if (!configured) return DEFAULT_SITE_URL;
  return configured.endsWith('/') ? configured : `${configured}/`;
};

// An absent preference means "enabled", matching the app's local defaults.
export const isEmailEnabledForUser = (preferences) => preferences?.emailEnabled !== false;

export const isReminderEnabledForUser = (preferences, daysBefore) => {
  const key = REMINDER_OFFSET_KEYS[daysBefore];
  if (!key) return false;
  return preferences?.deadlineReminders?.[key] !== false;
};

export const formatDeadlineLabel = (value) => {
  if (!value) return 'No deadline recorded';
  const iso = String(value).slice(0, 10);
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
};

const renderDetailRows = (rows) => (rows || [])
  .map(({ label, value }) => `            <tr>
              <td bgcolor="#ffffff" align="left" valign="top" width="40%" style="background-color:#ffffff; width:40%; padding-top:10px; padding-bottom:10px; padding-left:28px; padding-right:16px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER}; font-family:${FONT}; font-size:13px; line-height:18px; color:${MUTED};">${escapeHtml(label)}</td>
              <td bgcolor="#ffffff" align="left" valign="top" style="background-color:#ffffff; padding-top:10px; padding-bottom:10px; padding-left:16px; padding-right:28px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER}; font-family:${FONT}; font-size:13px; line-height:18px; color:${TEXT}; font-weight:bold;">${escapeHtml(value)}</td>
            </tr>`)
  .join('\n');

const renderEmailLayout = ({ heading, intro, rows, ctaLabel, ctaUrl, footerNote }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body bgcolor="${SURFACE}" style="background-color:${SURFACE}; margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; padding-top:0; padding-bottom:0; padding-left:0; padding-right:0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr>
        <td style="font-family:${FONT}; font-size:1px; line-height:1px; color:${SURFACE}; max-height:0; overflow:hidden;">${escapeHtml(intro)}</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${SURFACE}" style="background-color:${SURFACE};">
      <tr>
        <td align="center" style="padding-top:32px; padding-bottom:32px; padding-left:12px; padding-right:12px;">
          <!--[if mso]>
          <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td>
          <![endif]-->
          <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:12px;">
            <tr>
              <td bgcolor="${PRIMARY}" style="background-color:${PRIMARY}; padding-top:22px; padding-bottom:22px; padding-left:28px; padding-right:28px;">
                <p style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:11px; line-height:16px; color:#bfd0ea; letter-spacing:0.08em; text-transform:uppercase;">Ateneo de Davao University</p>
                <p style="margin-top:4px; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:20px; line-height:26px; color:#ffffff; font-weight:bold;">ScholarPath AdDU</p>
              </td>
            </tr>
            <tr>
              <td style="padding-top:26px; padding-bottom:0; padding-left:28px; padding-right:28px;">
                <h1 style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:19px; line-height:26px; color:${TEXT}; font-weight:bold;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding-top:10px; padding-bottom:14px; padding-left:28px; padding-right:28px;">
                <p style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:14px; line-height:21px; color:${MUTED};">${escapeHtml(intro)}</p>
              </td>
            </tr>
${renderDetailRows(rows)}
            <tr>
              <td align="center" style="padding-top:24px; padding-bottom:28px; padding-left:28px; padding-right:28px;">
                <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td align="center" bgcolor="${ACCENT}" style="background-color:${ACCENT}; border-radius:8px;">
                      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block; padding-top:13px; padding-bottom:13px; padding-left:26px; padding-right:26px; font-family:${FONT}; font-size:15px; line-height:20px; color:#ffffff; font-weight:bold; text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="${SURFACE}" style="background-color:${SURFACE}; padding-top:18px; padding-bottom:18px; padding-left:28px; padding-right:28px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER};">
                <p style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:12px; line-height:18px; color:${MUTED};">${escapeHtml(footerNote)}</p>
                <p style="margin-top:8px; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:12px; line-height:18px; color:${MUTED};">You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.</p>
              </td>
            </tr>
          </table>
          <!--[if mso]>
          </td></tr></table>
          <![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;

/**
 * Renders the deadline reminder email.
 *
 * `title` is passed straight through as the subject so the server-side subject
 * matches the in-app notification title exactly, which is what
 * src/lib/notificationMerge.js deduplicates against.
 */
export const renderReminderEmail = ({ title, itemTitle, deadline, daysBefore, siteUrl }) => {
  const label = daysBefore === 1 ? 'day' : 'days';
  const subject = title || `Reminder: "${itemTitle}" due in ${daysBefore} ${label}`;
  const intro = daysBefore === 1
    ? 'Your deadline is tomorrow. Make sure all required documents are ready to submit.'
    : `You have ${daysBefore} days to prepare the documents and materials this deadline requires.`;
  const link = `${siteUrl}?view=calendar`;

  return {
    subject,
    html: renderEmailLayout({
      heading: subject,
      intro,
      rows: [
        { label: 'Scholarship / deadline', value: itemTitle },
        { label: 'Due date', value: formatDeadlineLabel(deadline) },
        { label: 'Time remaining', value: `${daysBefore} ${label}` },
      ],
      ctaLabel: 'Open ScholarPath AdDU',
      ctaUrl: link,
      footerNote: 'This reminder follows the reminder timing you selected in Settings.',
    }),
    text: [
      subject,
      '',
      intro,
      '',
      `Scholarship / deadline: ${itemTitle}`,
      `Due date: ${formatDeadlineLabel(deadline)}`,
      `Time remaining: ${daysBefore} ${label}`,
      '',
      `Open ScholarPath AdDU: ${link}`,
      '',
      'You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.',
    ].join('\n'),
  };
};

/**
 * Renders an application status-change email for the application workspace.
 */
export const renderApplicationStatusEmail = ({ subject, body, scholarshipTitle, status, siteUrl }) => {
  const heading = subject || `Application update: ${status}`;
  const intro = body || `Your application status was updated to ${status}.`;
  const link = `${siteUrl}?view=applications`;

  return {
    subject: heading,
    html: renderEmailLayout({
      heading,
      intro,
      rows: [
        { label: 'Scholarship', value: scholarshipTitle },
        { label: 'New status', value: status },
      ],
      ctaLabel: 'View your applications',
      ctaUrl: link,
      footerNote: 'Status updates are sent as they are recorded by the reviewing office.',
    }),
    text: [
      heading,
      '',
      intro,
      '',
      `Scholarship: ${scholarshipTitle}`,
      `New status: ${status}`,
      '',
      `View your applications: ${link}`,
      '',
      'You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.',
    ].join('\n'),
  };
};

/**
 * Renders the self-service test email used by the Settings page so a signed-in
 * user can confirm real delivery without waiting for a scheduled reminder.
 */
export const renderTestEmail = ({ fullName, emailEnabled, siteUrl }) => {
  const heading = 'Email notifications are working';
  const intro = emailEnabled === false
    ? 'This is a delivery test. Note that your Email Notifications toggle is currently OFF, so scheduled reminders will not be emailed until you turn it on.'
    : 'This is a delivery test. Your Email Notifications toggle is ON, so deadline reminders and application status updates will reach this inbox.';
  const link = `${siteUrl}?view=settings`;

  return {
    subject: 'ScholarPath AdDU email notification test',
    html: renderEmailLayout({
      heading,
      intro,
      rows: [
        { label: 'Recipient', value: fullName || 'ScholarPath user' },
        { label: 'Email notifications', value: emailEnabled === false ? 'Disabled' : 'Enabled' },
      ],
      ctaLabel: 'Review notification settings',
      ctaUrl: link,
      footerNote: 'You requested this test from the notification center settings.',
    }),
    text: [
      'ScholarPath AdDU email notification test',
      '',
      intro,
      '',
      `Recipient: ${fullName || 'ScholarPath user'}`,
      `Email notifications: ${emailEnabled === false ? 'Disabled' : 'Enabled'}`,
      '',
      `Review notification settings: ${link}`,
    ].join('\n'),
  };
};
