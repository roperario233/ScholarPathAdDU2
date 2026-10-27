/**
 * Shared iprogSMS client and SMS text renderers.
 *
 * The mobile channel of the notification subsystem, mirroring _shared/resend.js
 * and _shared/email.js. Dependency-free (plain fetch, no SDK) so both the
 * Supabase Edge Functions (Deno) and the vitest suite can import it. The API
 * token is only ever read from the Edge Function environment — it must never
 * be shipped to the browser bundle.
 *
 * iprogSMS queueing notes (https://www.iprogsms.com/api/v1/documentation):
 *   * A 200 response confirms the message entered the queue (message_id); it
 *     does not confirm carrier delivery. Status is poll-only via
 *     GET /sms_messages/status — there are no webhooks — so the delivery
 *     ledger records queue-accept, not carrier delivery.
 *   * Globe, TM, DITO, and GOMO recipients receive the shared "iprogSMS"
 *     sender name; Smart and TNT recipients need a paid custom sender name.
 */

import { formatDeadlineLabel } from './email.js';
import { getApplicationStatusLabel } from './applicationStatus.js';
import { formatInterviewDateShort, isStructuredInterview } from './interview.js';

export const IPROGSMS_ENDPOINT = 'https://www.iprogsms.com/api/v1/sms_messages';

export const getSmsConfig = (env = {}) => ({
  apiToken: String(env.IPROGSMS_API_TOKEN ?? '').trim(),
  provider: String(env.IPROGSMS_PROVIDER ?? '').trim(),
});

/**
 * Normalizes a Philippine mobile number to the international 639XXXXXXXXX form
 * iprogSMS expects. Accepts "+63 912 345 6789", "0912-345-6789",
 * "09171234567", and "639171234567"; returns null for anything else
 * (landlines, foreign numbers, or entries that are too short).
 */
export const normalizePhilippineMobile = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  let candidate;
  if (digits.length === 12 && digits.startsWith('63')) {
    candidate = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    candidate = `63${digits.slice(1)}`;
  } else if (digits.length === 10 && digits.startsWith('9')) {
    candidate = `63${digits}`;
  } else {
    return null;
  }

  return /^639\d{9}$/.test(candidate) ? candidate : null;
};

/** Renders "639123456789" as "+63 912 345 6789", or null when not a PH mobile. */
export const formatPhilippineMobile = (raw) => {
  const normalized = normalizePhilippineMobile(raw);
  if (!normalized) return null;
  return `+${normalized.slice(0, 2)} ${normalized.slice(2, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8)}`;
};

/** Masks a stored number for display, e.g. "+63 91•• ••• 6789". */
export const maskPhilippineMobile = (raw) => {
  const normalized = normalizePhilippineMobile(raw);
  if (!normalized) return null;
  return `+63 ${normalized.slice(2, 4)}•• ••• ${normalized.slice(8)}`;
};

// An absent preference means "enabled", matching the app's local defaults and
// the email channel's convention in _shared/email.js.
export const isSmsEnabledForUser = (preferences) => preferences?.smsEnabled !== false;


// The gateway sometimes returns its error text as an array (e.g. the
// Smart/TNT sender-name rejection), so coerce any payload message into a
// single readable string before it reaches the ledger or the response.
export const toErrorMessage = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ');
  return value;
};

/**
 * Sends one SMS through iprogSMS. The token is placed in the JSON body rather
 * than the query string so it never lands in URLs or access logs.
 *
 * Returns a discriminated result instead of throwing so callers can record the
 * outcome in the delivery ledger rather than losing the whole run — the same
 * contract as _shared/resend.js sendEmail.
 *
 * @returns {Promise<{ok: boolean, skipped: boolean, reason?: string, messageId?: string|null, error?: string, status?: number}>}
 */
export const sendSms = async ({ apiToken, phoneNumber, message, provider }) => {
  if (!apiToken) {
    return { ok: false, skipped: true, reason: 'IPROGSMS_API_TOKEN is not configured' };
  }
  if (!phoneNumber) {
    return { ok: false, skipped: true, reason: 'Recipient has no mobile number on file' };
  }
  if (!message) {
    return { ok: false, skipped: true, reason: 'Message content is empty' };
  }

  const body = { api_token: apiToken, phone_number: phoneNumber, message };
  const parsedProvider = Number(provider);
  if (String(provider ?? '').trim() !== '' && Number.isFinite(parsedProvider)) {
    body.sms_provider = parsedProvider;
  }

  try {
    const response = await fetch(IPROGSMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
        error: toErrorMessage(payload?.message) || `iprogSMS responded with status ${response.status}`,
      };
    }

    const accepted = payload?.status === 200 || Boolean(payload?.message_id);
    if (!accepted) {
      return {
        ok: false,
        skipped: false,
        status: response.status,
        error: toErrorMessage(payload?.message) || 'iprogSMS did not accept the message',
      };
    }

    return { ok: true, skipped: false, messageId: payload?.message_id ?? null };
  } catch (error) {
    return { ok: false, skipped: false, error: error?.message || 'Unable to reach iprogSMS' };
  }
};

/**
 * Renders a deadline-reminder text message. Plain text only, kept short so a
 * reminder does not split into extra billable segments; the email channel
 * carries the links and the full detail.
 */
export const renderReminderSms = ({ title, itemTitle, deadline, daysBefore }) => {
  const dayLabel = Number(daysBefore) === 1 ? 'day' : 'days';
  const heading = title || `Reminder: "${itemTitle}" due in ${daysBefore} ${dayLabel}`;
  return {
    message: `ScholarPath AdDU: ${heading} (due ${formatDeadlineLabel(deadline)}). Sign in to review your deadline calendar.`,
  };
};

/** Renders an application status-change text message for the application workspace. */
export const renderApplicationStatusSms = ({ scholarshipTitle, status, interview = null }) => ({
  message: status === 'Rejected'
    // A general notice: the recorded reason stays with the Admissions Office.
    ? `ScholarPath AdDU: your application for ${scholarshipTitle || 'a scholarship'} was not accepted. Sign in to view details.`
    : status === 'Interview' && isStructuredInterview(interview)
      ? `ScholarPath AdDU: your ${scholarshipTitle || 'scholarship'} interview is on ${formatInterviewDateShort(interview.startsAt)} (${interview.mode === 'online' ? 'online' : 'on-site'}). Sign in for the details.`
      : `ScholarPath AdDU: your application for ${scholarshipTitle || 'a scholarship'} is now ${status ? getApplicationStatusLabel(status) : 'updated'}. Sign in to view details.`,
});

/** Renders the day-before interview reminder text. */
export const renderInterviewReminderSms = ({ interview, scholarshipTitle }) => ({
  message: `ScholarPath AdDU: reminder, your ${scholarshipTitle || 'scholarship'} interview is tomorrow, ${formatInterviewDateShort(interview?.startsAt)} (${interview?.mode === 'online' ? 'online' : 'on-site'}). Sign in for the details.`,
});

/** Renders an interview reschedule or cancellation text for the student. */
export const renderInterviewUpdateSms = ({ kind = 'rescheduled', interview, scholarshipTitle }) => ({
  message: kind === 'cancelled'
    ? `ScholarPath AdDU: your ${scholarshipTitle || 'scholarship'} interview was cancelled. Sign in for details.`
    : `ScholarPath AdDU: your ${scholarshipTitle || 'scholarship'} interview was moved to ${formatInterviewDateShort(interview?.startsAt)} (${interview?.mode === 'online' ? 'online' : 'on-site'}). Sign in for the details.`,
});

// Keeps the resubmission note short enough that the text stays within two
// billable segments; the email and in-app rows carry the full note.
export const SMS_REASON_MAX_LENGTH = 104;

/** Renders the text sent when the Admissions Office reverts a Document Vault file for resubmission. */
export const renderDocumentRejectionSms = ({ documentTitle, reason }) => {
  const trimmed = String(reason || '').trim().replace(/\s+/g, ' ');
  const shortReason = trimmed.length > SMS_REASON_MAX_LENGTH
    ? `${trimmed.slice(0, SMS_REASON_MAX_LENGTH - 1).trimEnd()}…`
    : trimmed;
  return {
    message: `ScholarPath AdDU: ${documentTitle || 'a document'} was reverted for resubmission${shortReason ? ` (${shortReason})` : ''}. Sign in to upload a corrected file.`,
  };
};

/**
 * Renders the self-service test text used by the Settings page so a signed-in
 * user can confirm real delivery to their own mobile number.
 */
export const renderTestSms = ({ fullName, smsEnabled }) => {
  const note = smsEnabled === false
    ? 'Note: your SMS Notifications toggle is currently OFF, so scheduled reminders will not be texted.'
    : 'Your SMS Notifications toggle is ON, so deadline reminders will reach this number.';
  return {
    message: `ScholarPath AdDU test for ${fullName || 'you'}. ${note}`,
  };
};
