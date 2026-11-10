/**
 * Deadline-reminder execution shared by the scheduled Edge Function and the
 * vitest suite.
 *
 * The module is dependency-free plain JavaScript. The Edge Function injects a
 * service-role Supabase client, and the tests inject a small in-memory client,
 * so the paging, grouping, delivery and ledger behavior can be exercised
 * without Deno or a real project.
 *
 * Reliability rules for this slice:
 * - Every Data API read pages until it sees a short page; the 1,000-row cap is
 *   never assumed to be the whole table.
 * - Recipient lookups use Maps/grouped collections instead of scanning the
 *   application list once per reminder.
 * - In-app rows and the delivery ledger carry stable keys, and the ledger
 *   upsert names its conflict target and checks the returned error.
 * - A failure for one recipient (or one profile batch) never aborts the rest of
 *   the run; anything not recorded in the ledger is retried on the next run.
 * - Delivery requests run in bounded batches so a large reminder day cannot
 *   fan out an unbounded number of provider calls at once.
 */

import { computeDueReminders, manilaDateKey, reminderDateKey } from './reminders.js';
import {
  isEmailEnabledForUser,
  isInAppEnabledForUser,
  isReminderEnabledForUser,
  renderInterviewReminderEmail,
  renderReminderEmail,
  resolveSiteUrl,
} from './email.js';
import {
  getInterviewDateKey,
  getInterviewReminderKey,
  isStructuredInterview,
  summarizeInterview,
} from './interview.js';
import { buildDeliveryAttempts, channelAttempt, inAppAttempt, recordDeliveryAttempts } from './deliveryAttempts.js';
import { getResendConfig, sendEmail } from './resend.js';
import {
  formatPhilippineMobile,
  getSmsConfig,
  isSmsEnabledForUser,
  normalizePhilippineMobile,
  renderInterviewReminderSms,
  renderReminderSms,
  sendSms,
} from './sms.js';

export const REMINDER_PAGE_SIZE = 500;
export const REMINDER_PROFILE_BATCH_SIZE = 100;
export const REMINDER_QUERY_CONCURRENCY = 4;
// Ledger keys are about 90 characters, so a smaller batch keeps the .in() URL
// well inside request-line limits.
export const REMINDER_LEDGER_BATCH_SIZE = 50;
// Decided outcomes: a deadline reminder no longer helps these applicants.
export const REMINDER_EXCLUDED_APPLICATION_STATUSES = ['Approved', 'Rejected', 'Released', 'Declined', 'Waitlisted'];
export const REMINDER_DELIVERY_CONCURRENCY = 4;

const chunk = (list, size) => {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
};

const errorMessage = (error) => String(error?.message ?? error ?? 'Unknown error');

/**
 * Reads every row of a query without relying on the PostgREST row cap.
 * `createQuery` must return a fresh builder; `.range()` is applied last.
 */
export const fetchPagedRows = async (createQuery, { pageSize = REMINDER_PAGE_SIZE } = {}) => {
  const boundedPageSize = Math.max(1, Math.floor(pageSize) || REMINDER_PAGE_SIZE);
  const rows = [];
  let offset = 0;

  while (true) {
    let pageResult;
    try {
      pageResult = await createQuery().range(offset, offset + boundedPageSize - 1);
    } catch (error) {
      return { data: null, error };
    }

    const { data, error } = pageResult;
    if (error) return { data: null, error };

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < boundedPageSize) return { data: rows, error: null };
    offset += boundedPageSize;
  }
};

/**
 * Runs `worker` over `items` with at most `concurrency` active at once.
 * Results keep the input order.
 */
export const mapWithConcurrency = async (items, worker, concurrency = REMINDER_DELIVERY_CONCURRENCY) => {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const boundedConcurrency = Math.max(1, Math.floor(concurrency) || REMINDER_DELIVERY_CONCURRENCY);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(boundedConcurrency, list.length) },
    async () => {
      while (nextIndex < list.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(list[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

/**
 * Reads rows for a list of ids in bounded `.in()` batches, paging each batch.
 */
export const fetchRowsInBatches = async (
  ids,
  createQuery,
  {
    batchSize = REMINDER_PROFILE_BATCH_SIZE,
    concurrency = REMINDER_QUERY_CONCURRENCY,
    pageSize = REMINDER_PAGE_SIZE,
  } = {},
) => {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!uniqueIds.length) return { data: [], error: null };

  const batches = chunk(uniqueIds, Math.max(1, Math.floor(batchSize) || REMINDER_PROFILE_BATCH_SIZE));
  const results = await mapWithConcurrency(
    batches,
    (batch) => fetchPagedRows(() => createQuery(batch), { pageSize }),
    concurrency,
  );

  const failure = results.find((result) => result.error);
  if (failure) return { data: null, error: failure.error };
  return { data: results.flatMap((result) => result.data), error: null };
};

const getRecipientIds = (reminder, collections) => {
  const { applicationsByScholarship, applicationById, customOwners } = collections;

  if (reminder.kind === 'custom') {
    const ownerId = customOwners.get(reminder.itemId);
    return ownerId ? [ownerId] : [];
  }
  if (reminder.kind === 'application' || reminder.kind === 'interview') {
    const studentId = applicationById.get(reminder.itemId)?.student_id;
    return studentId ? [studentId] : [];
  }
  const rows = applicationsByScholarship.get(reminder.itemId) ?? [];
  return [...new Set(rows.map((row) => row.student_id).filter(Boolean))];
};

const loadProfiles = async (supabase, recipientIds) => {
  const profileById = new Map();
  const lookupFailures = new Set();
  const batches = chunk([...new Set(recipientIds)], REMINDER_PROFILE_BATCH_SIZE);

  await mapWithConcurrency(batches, async (batch) => {
    try {
      const { data, error } = await fetchPagedRows(() => supabase
        .from('profiles')
        .select('user_id, full_name, email, phone, notification_preferences')
        .in('user_id', batch)
        .order('user_id', { ascending: true }));
      if (error) {
        for (const id of batch) lookupFailures.add(id);
        return;
      }
      for (const row of data ?? []) {
        if (row?.user_id) profileById.set(row.user_id, row);
      }
    } catch {
      for (const id of batch) lookupFailures.add(id);
    }
  }, REMINDER_QUERY_CONCURRENCY);

  return { profileById, lookupFailures };
};

const deliverReminderToRecipient = async ({
  supabase,
  reminder,
  profile,
  userKey,
  deadline,
  interviewReminder,
  siteUrl,
  resend,
  sms,
  allowSms,
  sendEmailImpl,
  sendSmsImpl,
}) => {
  const preferences = profile.notification_preferences ?? {};

  // A disabled reminder timing suppresses this reminder on every channel,
  // matching the client-side generator in src/App.jsx. Nothing is recorded for
  // it, so enabling the timing later still delivers it.
  if (!isReminderEnabledForUser(preferences, reminder.daysBefore)) {
    return { suppressed: true };
  }

  const isApplicationReminder = reminder.kind === 'application';
  const isCustomReminder = reminder.kind === 'custom';
  const kindLabel = interviewReminder
    ? 'Interview reminder'
    : isCustomReminder
      ? 'Personal deadline'
      : isApplicationReminder ? 'Application deadline' : 'Deadline reminder';
  const body = interviewReminder
    ? summarizeInterview(interviewReminder.interview)
    : `${reminder.itemTitle} is due on ${deadline ?? 'its recorded deadline'}.`;

  // Channel 1 - in-app row, gated by notificationPreferences.inAppEnabled.
  // notifications.channel is constrained to 'SMS' / 'Email' / 'In-app', so the
  // deadline kind is carried by the title and body instead. The stable
  // source_key is the same key the client generates locally, and the upsert is
  // idempotent so a retried run cannot duplicate or re-open the row.
  const wantsInApp = isInAppEnabledForUser(preferences);
  let inAppError = null;
  if (wantsInApp) {
    try {
      const { error } = await supabase.from('notifications').upsert({
        profile_id: profile.user_id,
        title: reminder.title,
        channel: 'In-app',
        body,
        status: 'Unread',
        source_key: reminder.sourceKey,
      }, { onConflict: 'profile_id,source_key', ignoreDuplicates: true });
      if (error) inAppError = errorMessage(error);
    } catch (error) {
      // One channel's transport failure must not skip the other channels or
      // the following recipients.
      inAppError = errorMessage(error);
    }
  }
  const inAppWritten = wantsInApp && !inAppError;

  // Channel 2 - email, gated by emailEnabled. The reminder timing is already
  // applied above, so a skip here means only that the student turned the email
  // channel off (or has no address / the provider is not configured).
  const wantsEmail = isEmailEnabledForUser(preferences);
  let emailResult = { ok: false, skipped: true, reason: 'Email notifications disabled' };
  if (wantsEmail) {
    const message = interviewReminder
      ? renderInterviewReminderEmail({
        title: reminder.title,
        interview: interviewReminder.interview,
        scholarshipTitle: interviewReminder.scholarshipTitle,
        siteUrl,
      })
      : renderReminderEmail({
        title: reminder.title,
        itemTitle: reminder.itemTitle,
        deadline,
        daysBefore: reminder.daysBefore,
        siteUrl,
      });
    try {
      emailResult = await sendEmailImpl({
        apiKey: resend.apiKey,
        from: resend.from,
        to: profile.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: userKey,
      });
    } catch (error) {
      emailResult = { ok: false, skipped: false, error: errorMessage(error) };
    }
  }

  // Channel 3 - SMS, gated by smsEnabled plus the reminder timing. SMS is only
  // sent by the trusted scheduled run: a manual signed-in invocation must not
  // fan text messages out to students.
  const smsTo = normalizePhilippineMobile(profile.phone);
  const wantsSms = isSmsEnabledForUser(preferences);
  const smsAttempted = wantsSms && allowSms;
  let smsResult = allowSms
    ? { ok: false, skipped: true, reason: 'SMS notifications disabled' }
    : { ok: false, skipped: true, reason: 'SMS is sent only by the scheduled reminder run' };
  if (smsAttempted && !smsTo) {
    smsResult = { ok: false, skipped: true, reason: 'This student has no mobile number on file' };
  } else if (smsAttempted) {
    const message = interviewReminder
      ? renderInterviewReminderSms({
        interview: interviewReminder.interview,
        scholarshipTitle: interviewReminder.scholarshipTitle,
      })
      : renderReminderSms({
        title: reminder.title,
        itemTitle: reminder.itemTitle,
        deadline,
        daysBefore: reminder.daysBefore,
      });
    try {
      smsResult = await sendSmsImpl({
        apiToken: sms.apiToken,
        phoneNumber: smsTo,
        message: message.message,
        provider: sms.provider,
      });
    } catch (error) {
      smsResult = { ok: false, skipped: false, error: errorMessage(error) };
    }
  }

  // Only write the ledger row when something was actually delivered. A
  // reminder where every attempted channel was unavailable (or the only
  // attempted channel failed) stays unlogged so the next run retries it
  // instead of dropping it permanently.
  let ledgerFailed = false;
  const delivered = inAppWritten || emailResult.ok || smsResult.ok;
  if (delivered) {
    const { error } = await supabase
      .from('notification_email_log')
      .upsert({
        source_key: userKey,
        user_id: profile.user_id,
        reminder_title: reminder.title,
        email_to: profile.email ?? null,
        email_status: emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
        email_id: emailResult.id ?? null,
        email_error: emailResult.error ?? null,
        sms_to: smsResult.ok ? (formatPhilippineMobile(profile.phone) ?? smsTo) : null,
        sms_status: smsResult.ok ? 'sent' : smsAttempted ? 'failed' : 'skipped',
        sms_message_id: smsResult.messageId ?? null,
        sms_error: smsResult.error ?? smsResult.reason ?? null,
      }, { onConflict: 'source_key,user_id' });
    if (error) ledgerFailed = true;
  }

  // The history of this run, one row per channel (status and a short code only).
  // A failure to write it never changes the reminder's outcome.
  await recordDeliveryAttempts(supabase, buildDeliveryAttempts({
    functionName: 'process-deadline-reminders',
    sourceKey: userKey,
    userId: profile.user_id,
    attempts: [
      inAppAttempt({ wanted: wantsInApp, error: inAppError }),
      channelAttempt({ channel: 'email', wanted: wantsEmail, result: emailResult }),
      channelAttempt({ channel: 'sms', wanted: smsAttempted, result: smsResult }),
    ],
  }));

  const emailStatus = emailResult.ok
    ? 'sent'
    : (emailResult.skipped || !wantsEmail) ? 'skipped' : 'failed';
  const smsStatus = smsResult.ok
    ? 'sent'
    : (smsResult.skipped || !smsAttempted) ? 'skipped' : 'failed';

  return {
    suppressed: false,
    inAppWritten,
    inAppError,
    emailOk: emailResult.ok,
    emailSkipped: !emailResult.ok && (emailResult.skipped || !wantsEmail),
    emailFailed: !emailResult.ok && !emailResult.skipped && wantsEmail,
    smsOk: smsResult.ok,
    smsSkipped: !smsResult.ok && (smsResult.skipped || !smsAttempted),
    smsFailed: !smsResult.ok && !smsResult.skipped && smsAttempted,
    ledgerFailed,
    entry: {
      userKey,
      userId: profile.user_id,
      title: reminder.title,
      kind: kindLabel,
      inApp: inAppWritten,
      inAppError,
      emailStatus,
      smsStatus,
    },
  };
};

/**
 * Computes and delivers the reminders that are due for the given Manila date.
 *
 * @param {object} options
 * @param {object} options.supabase - service-role Supabase client.
 * @param {string} [options.today] - Manila date key (YYYY-MM-DD).
 * @param {object} [options.env] - Edge Function environment (no PII).
 * @param {boolean} [options.allowSms] - true only for the trusted scheduled caller.
 * @param {Function} [options.sendEmailImpl] - injectable email sender.
 * @param {Function} [options.sendSmsImpl] - injectable SMS sender.
 */
export const runDeadlineReminders = async ({
  supabase,
  today = manilaDateKey(),
  env = {},
  allowSms = true,
  sendEmailImpl = sendEmail,
  sendSmsImpl = sendSms,
}) => {
  // Deadline sources are read in full pages. The ordering key keeps offsets
  // stable while rows are added between pages.
  const [scholarshipsResult, applicationsResult, customResult] = await Promise.all([
    fetchPagedRows(() => supabase
      .from('scholarships')
      .select('id, title, deadline')
      .eq('is_active', true)
      .not('deadline', 'is', null)
      .order('id', { ascending: true })),
    fetchPagedRows(() => supabase
      .from('applications')
      .select('id, scholarship_id, status, student_id, interview')
      .not('status', 'in', `(${REMINDER_EXCLUDED_APPLICATION_STATUSES.map((status) => `"${status}"`).join(',')})`)
      .order('id', { ascending: true })),
    fetchPagedRows(() => supabase
      .from('custom_deadlines')
      .select('id, owner_id, title, deadline')
      .order('id', { ascending: true })),
  ]);

  if (scholarshipsResult.error) throw scholarshipsResult.error;
  if (applicationsResult.error) throw applicationsResult.error;
  if (customResult.error) throw customResult.error;

  const activeScholarships = scholarshipsResult.data ?? [];
  const applications = applicationsResult.data ?? [];
  const customDeadlines = customResult.data ?? [];

  const scholarshipById = new Map(activeScholarships.map((row) => [row.id, row]));
  const applicationById = new Map();
  const applicationsByScholarship = new Map();

  for (const application of applications) {
    applicationById.set(application.id, application);
    if (!applicationsByScholarship.has(application.scholarship_id)) {
      applicationsByScholarship.set(application.scholarship_id, []);
    }
    applicationsByScholarship.get(application.scholarship_id).push(application);
  }

  // Application reminders resolve their deadline through the scholarship. Only
  // the linked ids missing from the active read are fetched, in bounded
  // `.in()` batches that are themselves paged.
  const missingScholarshipIds = [...new Set(
    applications.map((application) => application.scholarship_id).filter(Boolean),
  )].filter((id) => !scholarshipById.has(id));

  const linkedResult = await fetchRowsInBatches(missingScholarshipIds, (batch) => supabase
    .from('scholarships')
    .select('id, title, deadline')
    .in('id', batch)
    .order('id', { ascending: true }));
  if (linkedResult.error) throw linkedResult.error;
  for (const row of linkedResult.data ?? []) {
    scholarshipById.set(row.id, row);
  }

  const items = activeScholarships.map((row) => ({
    id: row.id,
    title: row.title,
    deadline: row.deadline,
    kind: 'scholarship',
  }));

  for (const application of applications) {
    const scholarship = scholarshipById.get(application.scholarship_id);
    if (!scholarship?.deadline) continue;
    items.push({
      id: application.id,
      title: scholarship.title,
      deadline: scholarship.deadline,
      kind: 'application',
    });
  }

  // Persisted student-created calendar deadlines. The client generates the same
  // `deadline-reminder-<id>-<days>` sourceKey locally, so the stored id is
  // reused verbatim here.
  const customOwners = new Map();
  for (const row of customDeadlines) {
    customOwners.set(row.id, row.owner_id);
    items.push({
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      kind: 'custom',
    });
  }

  const dueReminders = computeDueReminders({ today, items });

  // SOP step 5: the day-before reminder for each scheduled interview, due from
  // the day before through the interview day (catch-up, like the deadline rule).
  const interviewById = new Map();
  for (const application of applications) {
    if (application.status !== 'Interview') continue;
    if (!isStructuredInterview(application.interview)) continue;
    if (application.interview.state !== 'scheduled') continue;

    const interviewDate = getInterviewDateKey(application.interview.startsAt);
    if (!interviewDate || reminderDateKey(interviewDate, 1) > today || today > interviewDate) continue;

    const scholarshipTitle = scholarshipById.get(application.scholarship_id)?.title || 'scholarship';
    interviewById.set(application.id, { interview: application.interview, scholarshipTitle });
    dueReminders.push({
      sourceKey: getInterviewReminderKey(application.id, application.interview.revision),
      itemId: application.id,
      itemTitle: scholarshipTitle,
      kind: 'interview',
      daysBefore: 1,
      title: `Reminder: your ${scholarshipTitle} interview is tomorrow`,
    });
  }

  const deadlineById = new Map(items.map((item) => [item.id, item.deadline]));
  const collections = { applicationsByScholarship, applicationById, customOwners };

  // Build the per-recipient work first so profiles can be loaded in bounded
  // batches instead of one query per reminder inside the delivery loop.
  const pending = [];
  const seenPairs = new Set();
  for (const reminder of dueReminders) {
    const deadline = deadlineById.get(reminder.itemId) ?? null;
    const interviewReminder = reminder.kind === 'interview'
      ? interviewById.get(reminder.itemId)
      : null;
    for (const userId of getRecipientIds(reminder, collections)) {
      const userKey = `${reminder.sourceKey}:${userId}`;
      if (seenPairs.has(userKey)) continue;
      seenPairs.add(userKey);
      pending.push({ reminder, userId, userKey, deadline, interviewReminder });
    }
  }

  // Only the candidate keys are looked up in the delivery ledger: it grows with
  // every reminder ever sent, so reading it whole would make each run slower than
  // the last. A failed lookup aborts the run rather than risk resending.
  const ledgerResult = await fetchRowsInBatches(
    pending.map((entry) => entry.userKey),
    (batch) => supabase
      .from('notification_email_log')
      .select('source_key')
      .in('source_key', batch)
      .order('source_key', { ascending: true }),
    { batchSize: REMINDER_LEDGER_BATCH_SIZE },
  );
  if (ledgerResult.error) throw ledgerResult.error;
  const deliveredKeys = new Set((ledgerResult.data ?? []).map((row) => row.source_key).filter(Boolean));
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    if (deliveredKeys.has(pending[index].userKey)) pending.splice(index, 1);
  }

  const envObject = env ?? {};
  const siteUrl = resolveSiteUrl(envObject);
  const resend = getResendConfig(envObject);
  const sms = getSmsConfig(envObject);

  const { profileById, lookupFailures } = await loadProfiles(
    supabase,
    pending.map((entry) => entry.userId),
  );

  const outcomes = await mapWithConcurrency(pending, async (entry) => {
    const profile = profileById.get(entry.userId);
    if (!profile) {
      return { profileMissing: lookupFailures.has(entry.userId) ? 'lookup-failed' : 'not-found' };
    }
    try {
      return await deliverReminderToRecipient({
        supabase,
        reminder: entry.reminder,
        profile,
        userKey: entry.userKey,
        deadline: entry.deadline,
        interviewReminder: entry.interviewReminder,
        siteUrl,
        resend,
        sms,
        allowSms,
        sendEmailImpl,
        sendSmsImpl,
      });
    } catch {
      // One recipient's failure (a network error, a thrown provider call) must
      // not stop the remaining recipients or reminders. Nothing is logged with
      // the recipient's address or phone number.
      return { failed: true };
    }
  }, REMINDER_DELIVERY_CONCURRENCY);

  const stats = {
    inApp: 0,
    emailed: 0,
    emailSkipped: 0,
    emailFailed: 0,
    smsSent: 0,
    smsSkipped: 0,
    smsFailed: 0,
    suppressed: 0,
    failed: 0,
    ledgerFailed: 0,
    profileMissing: 0,
    profileLookupFailed: 0,
  };
  const deliveries = [];

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.profileMissing === 'lookup-failed') {
      stats.profileLookupFailed += 1;
      continue;
    }
    if (outcome.profileMissing) {
      stats.profileMissing += 1;
      continue;
    }
    if (outcome.failed) {
      stats.failed += 1;
      continue;
    }
    if (outcome.suppressed) {
      stats.suppressed += 1;
      continue;
    }

    if (outcome.inAppWritten) stats.inApp += 1;
    if (outcome.emailOk) stats.emailed += 1;
    else if (outcome.emailSkipped) stats.emailSkipped += 1;
    else if (outcome.emailFailed) stats.emailFailed += 1;

    if (outcome.smsOk) stats.smsSent += 1;
    else if (outcome.smsSkipped) stats.smsSkipped += 1;
    else if (outcome.smsFailed) stats.smsFailed += 1;

    if (outcome.ledgerFailed) stats.ledgerFailed += 1;
    if (outcome.entry) deliveries.push(outcome.entry);
  }

  return {
    today,
    dueReminders: dueReminders.length,
    deliveries: deliveries.length,
    inAppWritten: stats.inApp,
    emailsSent: stats.emailed,
    emailSkipped: stats.emailSkipped,
    emailFailed: stats.emailFailed,
    suppressed: stats.suppressed,
    failed: stats.failed,
    ledgerFailed: stats.ledgerFailed,
    profileMissing: stats.profileMissing,
    profileLookupFailed: stats.profileLookupFailed,
    emailConfigured: Boolean(resend.apiKey),
    smsSent: stats.smsSent,
    smsSkipped: stats.smsSkipped,
    smsFailed: stats.smsFailed,
    smsConfigured: Boolean(sms.apiToken),
    // Preview intentionally carries no email address, phone number, or
    // provider error text: cron responses must not become a PII log.
    preview: deliveries.slice(0, 10),
  };
};
