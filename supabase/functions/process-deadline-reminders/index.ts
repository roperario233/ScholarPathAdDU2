// Supabase Edge Function: process-deadline-reminders
//
// Server-side reminder trigger. Intended to be invoked on a schedule via
// pg_cron + pg_net (see the scheduling block at the bottom of
// supabase/schema.sql).
//
// Computes the deadline reminders that are due today (Manila calendar) from
// active scholarships, non-terminal applications, and persisted custom
// deadlines; writes the in-app notification, emails the recipient through
// Resend, and records every delivery in notification_email_log so a reminder
// reaches a given student at most once.
//
// Each channel is independently opt-in, matching the notification center
// settings: the in-app row honors `inAppEnabled`, and the email honors
// `emailEnabled` plus the 7-day / 3-day / 1-day reminder toggles.
//
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional), REMINDER_CRON_SECRET.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { computeDueReminders, manilaDateKey } from '../_shared/reminders.js';
import { isEmailEnabledForUser, isReminderEnabledForUser, renderReminderEmail, resolveSiteUrl } from '../_shared/email.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  // This function is deployed with verify_jwt disabled, because the scheduled
  // caller (pg_cron via pg_net) presents a shared secret rather than a JWT, and
  // the platform-level JWT check rejects service role keys. Authorization is
  // enforced here instead: the caller must present the dedicated cron secret, or
  // be a signed-in user for manual on-demand runs.
  //
  // The check fails closed when REMINDER_CRON_SECRET is unset, and the token is
  // compared by exact value rather than by inspecting a JWT role claim, so a
  // forged token cannot authorize itself.
  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET') ?? '';

  if (!authorizationHeader || !token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  if (!cronSecret || token !== cronSecret) {
    // Not the scheduled caller, so fall back to a signed-in user JWT.
    const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
    if (jwtError || !jwtUser?.user) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  // The reminder rule is evaluated against the Manila calendar.
  const today = manilaDateKey();

  try {
    // Deadline sources: active scholarships and non-terminal applications.
    const [{ data: scholarships, error: scholarshipsError }, { data: applications, error: applicationsError }] =
      await Promise.all([
        supabaseAdmin
          .from('scholarships')
          .select('id, title, deadline')
          .eq('is_active', true)
          .not('deadline', 'is', null),
        supabaseAdmin
          .from('applications')
          .select('id, scholarship_id, status, student_id')
          .not('status', 'in', '("Approved","Rejected")'),
      ]);
    if (scholarshipsError) throw scholarshipsError;
    if (applicationsError) throw applicationsError;

    const items = (scholarships ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      kind: 'scholarship',
    }));

    // Application reminders resolve their deadline through the scholarship.
    if (applications?.length) {
      const scholarshipIds = [...new Set(applications.map((row) => row.scholarship_id))];
      const { data: linked, error: linkedError } = await supabaseAdmin
        .from('scholarships')
        .select('id, title, deadline')
        .in('id', scholarshipIds)
        .not('deadline', 'is', null);
      if (linkedError) throw linkedError;

      const byId = new Map((linked ?? []).map((row) => [row.id, row]));
      for (const application of applications) {
        const scholarship = byId.get(application.scholarship_id);
        if (!scholarship) continue;
        items.push({
          id: application.id,
          title: scholarship.title,
          deadline: scholarship.deadline,
          kind: 'application',
        });
      }
    }

    // Persisted student-created calendar deadlines. The client generates the
    // same `deadline-reminder-<id>-<days>` sourceKey locally, so the stored id
    // is reused verbatim here.
    const { data: customDeadlines, error: customError } = await supabaseAdmin
      .from('custom_deadlines')
      .select('id, owner_id, title, deadline');
    if (customError) throw customError;

    const customOwners = new Map();
    for (const row of customDeadlines ?? []) {
      customOwners.set(row.id, row.owner_id);
      items.push({
        id: row.id,
        title: row.title,
        deadline: row.deadline,
        kind: 'custom',
      });
    }

    // Delivery ledger. source_key is stored as `<sourceKey>:<userId>` so the
    // at-most-once guarantee is per student, per reminder.
    const { data: existingLog, error: logError } = await supabaseAdmin
      .from('notification_email_log')
      .select('source_key');
    if (logError) throw logError;
    const deliveredKeys = new Set((existingLog ?? []).map((row) => row.source_key));

    const dueReminders = computeDueReminders({ today, items });
    const deadlineById = new Map(items.map((item) => [item.id, item.deadline]));
    const siteUrl = resolveSiteUrl(Deno.env.toObject());
    const resend = getResendConfig(Deno.env.toObject());
    const recipients = new Map();
    const deliveries = [];
    const stats = { inApp: 0, emailed: 0, emailSkipped: 0, emailFailed: 0 };

    for (const reminder of dueReminders) {
      const isApplicationReminder = reminder.kind === 'application';
      const isCustomReminder = reminder.kind === 'custom';
      const recipientIds = isCustomReminder
        ? [customOwners.get(reminder.itemId)].filter(Boolean)
        : isApplicationReminder
          ? [applications.find((row) => row.id === reminder.itemId)?.student_id].filter(Boolean)
          : applications
              .filter((row) => row.scholarship_id === reminder.itemId)
              .map((row) => row.student_id);

      const deadline = deadlineById.get(reminder.itemId) ?? null;

      for (const userId of recipientIds) {
        const userKey = `${reminder.sourceKey}:${userId}`;
        if (deliveredKeys.has(userKey)) continue;

        if (!recipients.has(userId)) {
          const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('user_id, full_name, email, notification_preferences')
            .eq('user_id', userId)
            .maybeSingle();
          if (profileError) throw profileError;
          if (profile) recipients.set(userId, profile);
        }

        const profile = recipients.get(userId);
        if (!profile) continue;

        const preferences = profile.notification_preferences ?? {};
        const kindLabel = isCustomReminder
          ? 'Personal deadline'
          : isApplicationReminder ? 'Application deadline' : 'Deadline reminder';
        const body = `${reminder.itemTitle} is due on ${deadline ?? 'its recorded deadline'}.`;

        // Both channels for this reminder are gated by the reminder timing,
        // matching the client-side generator in src/App.jsx: a disabled offset
        // suppresses that reminder on every channel.
        const offsetEnabled = isReminderEnabledForUser(preferences, reminder.daysBefore);

        // Channel 1 — in-app row, gated by notificationPreferences.inAppEnabled.
        // notifications.channel is constrained to 'SMS' / 'Email' / 'In-app', so
        // the deadline kind is carried by the title and body instead.
        const wantsInApp = preferences.inAppEnabled !== false && offsetEnabled;
        let inAppError = null;
        if (wantsInApp) {
          const { error: notificationError } = await supabaseAdmin.from('notifications').insert({
            profile_id: profile.user_id,
            title: reminder.title,
            channel: 'In-app',
            body,
            status: 'Unread',
          });
          if (notificationError) inAppError = notificationError.message;
          else stats.inApp += 1;
        }
        const inAppWritten = wantsInApp && !inAppError;

        // Channel 2 — email, gated by emailEnabled plus the reminder timing.
        const wantsEmail = isEmailEnabledForUser(preferences) && offsetEnabled;
        let emailResult = { ok: false, skipped: true, reason: 'Email notifications disabled' };

        if (wantsEmail) {
          const message = renderReminderEmail({
            title: reminder.title,
            itemTitle: reminder.itemTitle,
            deadline,
            daysBefore: reminder.daysBefore,
            siteUrl,
          });
          emailResult = await sendEmail({
            apiKey: resend.apiKey,
            from: resend.from,
            to: profile.email,
            subject: message.subject,
            html: message.html,
            text: message.text,
            idempotencyKey: userKey,
          });
          if (emailResult.ok) stats.emailed += 1;
          else if (emailResult.skipped) stats.emailSkipped += 1;
          else stats.emailFailed += 1;
        } else {
          stats.emailSkipped += 1;
        }

        // Only write the ledger row when something was actually delivered. A
        // reminder where both channels were unavailable (or the only attempted
        // channel failed) stays unlogged so the next run retries it instead of
        // dropping it permanently.
        if (inAppWritten || emailResult.ok) {
          await supabaseAdmin
            .from('notification_email_log')
            .upsert({
              source_key: userKey,
              user_id: profile.user_id,
              reminder_title: reminder.title,
              email_to: profile.email ?? null,
              email_status: emailResult.ok ? 'sent' : wantsEmail ? 'failed' : 'skipped',
              email_id: emailResult.id ?? null,
              email_error: emailResult.error ?? null,
            });
          deliveredKeys.add(userKey);
        }

        deliveries.push({
          userKey,
          userId: profile.user_id,
          to: profile.email ?? null,
          title: reminder.title,
          kind: kindLabel,
          inApp: inAppWritten,
          inAppError,
          emailStatus: emailResult.ok ? 'sent' : wantsEmail ? (emailResult.error || 'failed') : 'skipped',
        });
      }
    }

    return json({
      ok: true,
      today,
      dueReminders: dueReminders.length,
      deliveries: deliveries.length,
      inAppWritten: stats.inApp,
      emailsSent: stats.emailed,
      emailSkipped: stats.emailSkipped,
      emailFailed: stats.emailFailed,
      emailConfigured: Boolean(resend.apiKey),
      preview: deliveries.slice(0, 10),
    });
  } catch (error) {
    return json({ ok: false, error: String(error?.message ?? error) }, 500);
  }
});
