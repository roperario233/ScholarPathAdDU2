/**
 * Shared email rendering and delivery-preference helpers.
 *
 * Like `_shared/reminders.js`, this module is intentionally plain JavaScript
 * with no third-party dependencies, so it can be imported by both the Supabase
 * Edge Functions (Deno) and the vitest test suite. It renders Resend-compatible
 * HTML (table layouts, inline longhand styles, no images, no JavaScript)
 * alongside a plain-text alternative.
 */
import { getApplicationStatusLabel } from './applicationStatus.js';
import { describeInterviewForStudent, formatInterviewWhen, getInterviewModeLabel, isStructuredInterview, summarizeInterview } from './interview.js';

// Ateneo blue visual identity, matching the app's theme primitives.
const PRIMARY = '#0b2d5c';
const ACCENT = '#1f5fd6';
const SURFACE = '#f4f7fb';
const BORDER = '#d7e0ee';
const TEXT = '#11213a';
const MUTED = '#4d6383';
const FONT = 'Arial, Helvetica, sans-serif';
// Dark-mode palette used by the prefers-color-scheme block in the layout, so a
// client that supports dark mode renders the card on a dark surface instead of
// partially inverting the light theme.
const DARK_CANVAS = '#0f1421';
const DARK_CARD = '#171f33';
const DARK_BORDER = '#2a3856';
const DARK_TEXT = '#eef3fd';
const DARK_MUTED = '#aab9d6';
const DARK_FOOTER = '#121a2b';
const ACCENT_DARK = '#2f6fe4';

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

// Keep in-app status alerts opt-out consistent with the notification settings
// shape used by the client and the scheduled deadline-reminder function.
export const isInAppEnabledForUser = (preferences) => preferences?.inAppEnabled !== false;

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
              <td class="sp-row-label" bgcolor="#ffffff" align="left" valign="top" width="40%" style="background-color:#ffffff; width:40%; padding-top:10px; padding-bottom:10px; padding-left:28px; padding-right:16px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER}; font-family:${FONT}; font-size:13px; line-height:18px; color:${MUTED};">${escapeHtml(label)}</td>
              <td class="sp-row-value" bgcolor="#ffffff" align="left" valign="top" style="background-color:#ffffff; padding-top:10px; padding-bottom:10px; padding-left:16px; padding-right:28px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER}; font-family:${FONT}; font-size:13px; line-height:18px; color:${TEXT}; font-weight:bold;">${escapeHtml(value)}</td>
            </tr>`)
  .join('\n');

const renderEmailLayout = ({ heading, intro, rows, ctaLabel, ctaUrl, footerNote }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(heading)}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      @media (prefers-color-scheme: dark) {
        .sp-body, .sp-canvas { background-color: ${DARK_CANVAS} !important; }
        .sp-card, .sp-row-label, .sp-row-value { background-color: ${DARK_CARD} !important; }
        .sp-heading, .sp-row-value { color: ${DARK_TEXT} !important; }
        .sp-intro, .sp-row-label, .sp-footer-text { color: ${DARK_MUTED} !important; }
        .sp-row-label, .sp-row-value { border-top-color: ${DARK_BORDER} !important; }
        .sp-footer { background-color: ${DARK_FOOTER} !important; border-top-color: ${DARK_BORDER} !important; }
        .sp-cta { background-color: ${ACCENT_DARK} !important; }
        .sp-cta-link { color:#ffffff !important; }
      }
    </style>
  </head>
  <body class="sp-body" bgcolor="${SURFACE}" style="background-color:${SURFACE}; margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; padding-top:0; padding-bottom:0; padding-left:0; padding-right:0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr>
        <td style="font-family:${FONT}; font-size:1px; line-height:1px; color:${SURFACE}; max-height:0; overflow:hidden;">${escapeHtml(intro)}</td>
      </tr>
    </table>
    <table class="sp-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${SURFACE}" style="background-color:${SURFACE};">
      <tr>
        <td align="center" style="padding-top:32px; padding-bottom:32px; padding-left:12px; padding-right:12px;">
          <!--[if mso]>
          <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td>
          <![endif]-->
          <table class="sp-card" width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:12px;">
            <tr>
              <td class="sp-header" colspan="2" bgcolor="${PRIMARY}" style="background-color:${PRIMARY}; padding-top:22px; padding-bottom:22px; padding-left:28px; padding-right:28px;">
                <p style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:11px; line-height:16px; color:#bfd0ea; letter-spacing:0.08em; text-transform:uppercase;">Ateneo de Davao University</p>
                <p style="margin-top:4px; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:20px; line-height:26px; color:#ffffff; font-weight:bold;">ScholarPath AdDU</p>
              </td>
            </tr>
            <tr>
              <td class="sp-heading-cell" colspan="2" style="padding-top:26px; padding-bottom:0; padding-left:28px; padding-right:28px;">
                <h1 class="sp-heading" style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:19px; line-height:26px; color:${TEXT}; font-weight:bold;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td class="sp-intro-cell" colspan="2" style="padding-top:10px; padding-bottom:14px; padding-left:28px; padding-right:28px;">
                <p class="sp-intro" style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:14px; line-height:21px; color:${MUTED};">${escapeHtml(intro)}</p>
              </td>
            </tr>
${renderDetailRows(rows)}
            <tr>
              <td class="sp-cta-cell" colspan="2" align="center" style="padding-top:24px; padding-bottom:28px; padding-left:28px; padding-right:28px;">
                <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td class="sp-cta" align="center" bgcolor="${ACCENT}" style="background-color:${ACCENT}; border-radius:8px;">
                      <a class="sp-cta-link" href="${escapeHtml(ctaUrl)}" style="display:inline-block; padding-top:13px; padding-bottom:13px; padding-left:26px; padding-right:26px; font-family:${FONT}; font-size:15px; line-height:20px; color:#ffffff; font-weight:bold; text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="sp-footer" colspan="2" bgcolor="${SURFACE}" style="background-color:${SURFACE}; padding-top:18px; padding-bottom:18px; padding-left:28px; padding-right:28px; border-top-width:1px; border-top-style:solid; border-top-color:${BORDER};">
                <p class="sp-footer-text" style="margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:12px; line-height:18px; color:${MUTED};">${escapeHtml(footerNote)}</p>
                <p class="sp-footer-text" style="margin-top:8px; margin-bottom:0; margin-left:0; margin-right:0; font-family:${FONT}; font-size:12px; line-height:18px; color:${MUTED};">You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.</p>
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
 * The next-step sentence used by the application status email and in-app row.
 * "For Verification" is the SOP document-verification stage, so it names the
 * office holding the files and tells the applicant when to expect the next
 * message instead of the generic "status changed" copy. "Endorsed" is stored as
 * the Office of Admissions & Aid decision but shown as the step-4 endorsement
 * phase.
 */
export const describeApplicationStatusUpdate = (status, actorLabel = 'the reviewing office', { interview = null } = {}) => {
  if (status === 'For Verification') {
    return 'Your documents are now with the Admissions Office for verification. You will be notified when each file is verified or if a replacement is needed.';
  }
  if (status === 'For Endorsement') {
    return 'Your documents are verified and the Admissions Office has sent your application for endorsement. No action is needed from you right now.';
  }
  if (status === 'Endorsed') {
    return 'Your application is in the endorsement phase: the Office of Admissions & Aid has endorsed it, and the Admissions Office will schedule your interview with a panel from your school next.';
  }
  // SOP step 5: the first schedule rides the status notification, so the
  // message carries the date, the mode, and the location or meeting link.
  if (status === 'Interview' && isStructuredInterview(interview)) {
    return `Your interview is scheduled: ${summarizeInterview(interview)}.${interview.instructions ? ` ${interview.instructions}` : ''}`;
  }
  // A rejection is a general notice. The recorded reason stays with the
  // Admissions Office (FORM 230-SCH affidavit clause 6), and the student's
  // status history shows the same sentence.
  if (status === 'Rejected') {
    return 'Your application was not accepted. No further action is needed for this application period.';
  }
  return `Your application status was updated to ${getApplicationStatusLabel(status)} through ${actorLabel}. Sign in to review the next steps.`;
};

// The interview schedule as email detail rows. The panel is described by
// school only; panel member names never reach the applicant.
const interviewRows = (interview) => {
  if (!isStructuredInterview(interview)) return [];
  const view = describeInterviewForStudent(interview);
  return [
    { label: 'Interview', value: view.when },
    { label: getInterviewModeLabel(interview.mode), value: interview.mode === 'online' ? (interview.meetingUrl || 'Meeting link to follow') : view.where },
    ...(view.panel ? [{ label: 'Panel', value: view.panel }] : []),
  ];
};

/**
 * Renders an application status-change email for the application workspace.
 */
export const renderApplicationStatusEmail = ({ subject, body, scholarshipTitle, status, siteUrl, interview = null }) => {
  const statusLabel = getApplicationStatusLabel(status);
  const heading = subject || `Application update: ${statusLabel}`;
  const intro = body || `Your application status was updated to ${statusLabel}.`;
  const link = `${siteUrl}?view=applications`;

  return {
    subject: heading,
    html: renderEmailLayout({
      heading,
      intro,
      rows: [
        { label: 'Scholarship', value: scholarshipTitle },
        { label: 'New status', value: statusLabel },
        ...interviewRows(status === 'Interview' ? interview : null),
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
      `New status: ${statusLabel}`,
      ...interviewRows(status === 'Interview' ? interview : null).map((row) => `${row.label}: ${row.value}`),
      '',
      `View your applications: ${link}`,
      '',
      'You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.',
    ].join('\n'),
  };
};

/**
 * Renders the email sent when the Admissions Office reverts a Document Vault
 * file for resubmission. It carries what the student must correct and tells them
 * where to replace the file (the application's details, while the application is
 * before endorsement).
 */
export const renderDocumentRejectionEmail = ({ documentTitle, reason, scholarshipTitles = [], siteUrl }) => {
  const title = documentTitle || 'Your document';
  const heading = `${title} needs to be resubmitted`;
  const applications = (Array.isArray(scholarshipTitles) ? scholarshipTitles : []).filter(Boolean);
  const intro = applications.length
    ? 'The Admissions Office reverted this document for resubmission. Open the application in ScholarPath AdDU and replace the file so your application can continue.'
    : 'The Admissions Office reverted this document for resubmission. Upload a corrected file to your Document Vault.';
  const link = `${siteUrl}?view=applications`;
  const rows = [
    { label: 'Document', value: title },
    { label: 'What to correct', value: reason || 'No note was recorded.' },
    ...(applications.length ? [{ label: applications.length === 1 ? 'Application' : 'Applications', value: applications.join(', ') }] : []),
  ];

  return {
    subject: heading,
    html: renderEmailLayout({
      heading,
      intro,
      rows,
      ctaLabel: 'View your applications',
      ctaUrl: link,
      footerNote: 'Document decisions are sent as they are recorded by the Admissions Office.',
    }),
    text: [
      heading,
      '',
      intro,
      '',
      ...rows.map((row) => `${row.label}: ${row.value}`),
      '',
      `View your applications: ${link}`,
      '',
      'You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.',
    ].join('\n'),
  };
};

/**
 * Renders the day-before interview reminder (SOP step 5). The subject matches
 * the in-app title the app generates locally, so the two rows collapse.
 */
export const renderInterviewReminderEmail = ({ title, interview, scholarshipTitle, siteUrl }) => {
  const subject = title || `Reminder: your ${scholarshipTitle || 'scholarship'} interview is tomorrow`;
  const intro = interview?.mode === 'online'
    ? 'Your scholarship interview is tomorrow. Join a few minutes early from a quiet place with a stable connection.'
    : 'Your scholarship interview is tomorrow. Plan to arrive at least 10 minutes before your schedule.';
  const link = `${siteUrl}?view=applications`;
  const rows = [
    { label: 'Scholarship', value: scholarshipTitle || 'Scholarship application' },
    ...interviewRows(interview),
    ...(interview?.instructions ? [{ label: 'What to prepare', value: interview.instructions }] : []),
  ];
  return {
    subject,
    html: renderEmailLayout({
      heading: subject,
      intro,
      rows,
      ctaLabel: 'View your applications',
      ctaUrl: link,
      footerNote: 'This reminder follows the 1-day reminder timing you selected in Settings.',
    }),
    text: [
      subject,
      '',
      intro,
      '',
      ...rows.map((row) => `${row.label}: ${row.value}`),
      '',
      `View your applications: ${link}`,
      '',
      'You are receiving this because Email Notifications are enabled in your ScholarPath AdDU settings. You can change this any time under Settings.',
    ].join('\n'),
  };
};

/**
 * Renders an interview schedule change (SOP step 5).
 *
 * `audience` is 'student' (a reschedule or cancellation) or 'panelist' (a Department
 * Chair told about the panel they sit on). `kind` is 'scheduled',
 * 'rescheduled', or 'cancelled'.
 */
export const renderInterviewUpdateEmail = ({ audience = 'student', kind = 'scheduled', interview, scholarshipTitle, applicantName = '', reason = '', siteUrl }) => {
  const forPanel = audience === 'panelist';
  const title = scholarshipTitle || 'Scholarship application';
  const heading = kind === 'cancelled'
    ? (forPanel ? `Interview cancelled: ${applicantName || 'applicant'}` : 'Your scholarship interview was cancelled')
    : kind === 'rescheduled'
      ? (forPanel ? `Interview rescheduled: ${applicantName || 'applicant'}` : 'Your scholarship interview was rescheduled')
      : `Interview panel assignment: ${applicantName || 'applicant'}`;
  const intro = kind === 'cancelled'
    ? (forPanel
      ? 'The Admissions Office cancelled this interview. No action is needed unless it is scheduled again.'
      : 'The Admissions Office cancelled your interview. You will be notified if it is scheduled again.')
    : forPanel
      ? `You are on the interview panel for this applicant. Review the schedule and add your evaluation in the application's Interview tab after the interview.`
      : 'The Admissions Office changed your interview schedule. Please review the new details below.';
  const link = `${siteUrl}?view=${forPanel ? 'review' : 'applications'}`;
  const rows = [
    { label: 'Scholarship', value: title },
    ...(forPanel && applicantName ? [{ label: 'Applicant', value: applicantName }] : []),
    ...(kind === 'cancelled'
      ? [{ label: 'Cancelled schedule', value: formatInterviewWhen(interview?.startsAt, interview?.durationMinutes) }]
      : interviewRows(interview)),
    ...(reason ? [{ label: 'Reason', value: reason }] : []),
  ];
  const ctaLabel = forPanel ? 'Open the review queue' : 'View your applications';

  return {
    subject: heading,
    html: renderEmailLayout({
      heading,
      intro,
      rows,
      ctaLabel,
      ctaUrl: link,
      footerNote: 'Interview schedules are coordinated by the Admissions Office.',
    }),
    text: [
      heading,
      '',
      intro,
      '',
      ...rows.map((row) => `${row.label}: ${row.value}`),
      '',
      `${ctaLabel}: ${link}`,
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
