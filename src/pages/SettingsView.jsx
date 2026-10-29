import { useState } from 'react';
import { AlarmClock, BellRing, CalendarClock, CalendarDays, CalendarRange, CircleAlert, CircleCheck, Hourglass, Mail, MessageSquare, Send, ShieldCheck, Smartphone, Timer } from 'lucide-react';
import { Button, Card, SettingToggle, StatusBadge } from '../components/ui';
import { maskPhilippineMobile } from '../../supabase/functions/_shared/sms.js';
import { formatSessionDuration } from '../lib/sessionTimeout';

// One delivery-test tile (email or SMS): what it does, where it goes, the send
// action, and the result of the last attempt.
function DeliveryTest({ icon: Icon, title, description, detail = null, buttonLabel, state, onSend }) {
  const isSending = state.status === 'sending';
  return (
    <div className="rounded-2xl border border-dashed border-app-border bg-app-surface/60 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-app-muted-surface text-app-muted" aria-hidden="true"><Icon size={18} /></span>
          <div className="min-w-0">
            <strong className="block text-sm font-semibold text-app-text">{title}</strong>
            <span className="mt-1 block text-sm text-app-muted">{description}</span>
            {detail ? <span className="mt-1 block text-sm text-app-muted [overflow-wrap:anywhere]">{detail}</span> : null}
          </div>
        </div>
        <Button type="button" variant="primary" className="w-full gap-2 sm:w-auto" onClick={onSend} disabled={isSending}>
          <Send size={15} aria-hidden="true" />
          {isSending ? 'Sending…' : buttonLabel}
        </Button>
      </div>
      {state.message && (
        <p
          className={`mb-0 mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${state.status === 'success' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200'}`}
          role="status"
        >
          {state.status === 'success' ? <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0">{state.message}</span>
        </p>
      )}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, description, badge = null }) {
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-200" aria-hidden="true"><Icon size={18} /></span>
        <div className="min-w-0">
          <h3 className="m-0 text-lg font-semibold text-app-text">{title}</h3>
          <p className="mb-0 mt-1 text-sm text-app-muted">{description}</p>
        </div>
      </div>
      {badge}
    </div>
  );
}

export default function SettingsView({ notificationPreferences, onUpdatePreferences, isEmailDeliveryAvailable = false, onSendTestEmail, onSendTestSms = null, mobileNumber = '', sessionTimeoutConfig, profilePageLabel = 'My Profile' }) {
  const [testEmail, setTestEmail] = useState({ status: 'idle', message: '' });
  const [testSms, setTestSms] = useState({ status: 'idle', message: '' });
  const preferences = notificationPreferences || {
    smsEnabled: false,
    emailEnabled: false,
    inAppEnabled: true,
    deadlineReminders: { oneWeekBefore: true, threeDaysBefore: true, dayBefore: true },
  };

  const updatePreference = (key, value) => {
    onUpdatePreferences({
      ...preferences,
      [key]: value,
    });
  };

  const updateDeadlineReminder = (key, value) => {
    onUpdatePreferences({
      ...preferences,
      deadlineReminders: {
        ...preferences.deadlineReminders,
        [key]: value,
      },
    });
  };

  const handleSendTestEmail = async () => {
    if (!onSendTestEmail) return;
    setTestEmail({ status: 'sending', message: '' });
    const result = await onSendTestEmail();
    if (result?.sent) {
      setTestEmail({ status: 'success', message: `Test email sent to ${result.to || 'your inbox'}.` });
      return;
    }
    setTestEmail({ status: 'error', message: result?.reason || 'Unable to send the test email.' });
  };

  const handleSendTestSms = async () => {
    if (!onSendTestSms) return;
    setTestSms({ status: 'sending', message: '' });
    const result = await onSendTestSms();
    if (result?.sent) {
      setTestSms({ status: 'success', message: `Test text sent to ${result.to || 'your mobile number'}.` });
      return;
    }
    setTestSms({ status: 'error', message: result?.reason || 'Unable to send the test SMS.' });
  };

  const maskedMobileNumber = maskPhilippineMobile(mobileNumber);
  const reminders = preferences.deadlineReminders || {};
  const channelsOn = [preferences.smsEnabled, preferences.emailEnabled, preferences.inAppEnabled].filter(Boolean).length;
  const remindersOn = [reminders.oneWeekBefore, reminders.threeDaysBefore, reminders.dayBefore].filter(Boolean).length;
  const idleLabel = formatSessionDuration(sessionTimeoutConfig?.idleTimeoutMs ?? 15 * 60 * 1000);
  const totalLabel = formatSessionDuration(sessionTimeoutConfig?.absoluteTimeoutMs ?? 12 * 60 * 60 * 1000);

  return (
    <div className="grid gap-4">
      <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="page-title-copy">
            <span className="page-section-label">Settings</span>
            <h2>Notification settings</h2>
            <p className="mt-2 max-w-2xl text-sm text-app-muted">Choose how ScholarPath reaches you, and when.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={channelsOn ? 'success' : 'warning'}>{channelsOn} of 3 channels on</StatusBadge>
            <StatusBadge tone={remindersOn ? 'info' : 'warning'}>{remindersOn} of 3 reminders on</StatusBadge>
          </div>
        </div>
      </section>

      <Card>
        <SectionHeading icon={BellRing} title="Notification channels" description="Pick where deadline reminders and application status updates arrive." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SettingToggle
            icon={Smartphone}
            checked={preferences.smsEnabled}
            onChange={(value) => updatePreference('smsEnabled', value)}
            title="SMS Notifications"
            description="Deadline reminders and status updates by text"
          />
          <SettingToggle
            icon={Mail}
            checked={preferences.emailEnabled}
            onChange={(value) => updatePreference('emailEnabled', value)}
            title="Email Notifications"
            description="Deadline reminders and status updates by email"
          />
          <SettingToggle
            icon={MessageSquare}
            checked={preferences.inAppEnabled}
            onChange={(value) => updatePreference('inAppEnabled', value)}
            title="In-App Notifications"
            description="See updates and alerts when you're logged in"
          />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {onSendTestEmail ? (
            <DeliveryTest
              icon={Mail}
              title="Email delivery test"
              description="Sends one test email to your own address."
              buttonLabel="Send test email"
              state={testEmail}
              onSend={handleSendTestEmail}
            />
          ) : (
            <p className="m-0 rounded-2xl border border-dashed border-app-border bg-app-surface/60 p-4 text-sm text-app-muted">
              {isEmailDeliveryAvailable
                ? 'Email delivery is available, but the test sender is not wired up on this build.'
                : 'Email delivery activates once the Supabase workspace is configured for this prototype.'}
            </p>
          )}
          {onSendTestSms && (
            <DeliveryTest
              icon={Smartphone}
              title="SMS delivery test"
              description="Sends one test text to your own number."
              detail={maskedMobileNumber
                ? `Delivery number: ${maskedMobileNumber}`
                : `No mobile number on file — add one in ${profilePageLabel} → Personal information.`}
              buttonLabel="Send test SMS"
              state={testSms}
              onSend={handleSendTestSms}
            />
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading icon={CalendarClock} title="Deadline reminders" description="Choose when to be reminded before a deadline." />
          <div className="grid gap-3">
            <SettingToggle
              icon={CalendarRange}
              checked={reminders.oneWeekBefore}
              onChange={(value) => updateDeadlineReminder('oneWeekBefore', value)}
              title="1 Week Before"
              description="7 days before a deadline"
            />
            <SettingToggle
              icon={CalendarDays}
              checked={reminders.threeDaysBefore}
              onChange={(value) => updateDeadlineReminder('threeDaysBefore', value)}
              title="3 Days Before"
              description="3 days before a deadline"
            />
            <SettingToggle
              icon={AlarmClock}
              checked={reminders.dayBefore}
              onChange={(value) => updateDeadlineReminder('dayBefore', value)}
              title="Day Before"
              description="The day before the deadline"
            />
          </div>
        </Card>

        <Card>
          <SectionHeading icon={ShieldCheck} title="Session security" description="Your session ends on its own to protect your account." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-app-border bg-app-surface p-4">
              <Timer size={18} className="text-blue-600 dark:text-blue-200" aria-hidden="true" />
              <strong className="mt-3 block text-2xl font-bold leading-tight text-app-text">{idleLabel}</strong>
              <span className="mt-1 block text-sm text-app-muted">Idle limit — signed out after no activity</span>
            </div>
            <div className="rounded-2xl border border-app-border bg-app-surface p-4">
              <Hourglass size={18} className="text-blue-600 dark:text-blue-200" aria-hidden="true" />
              <strong className="mt-3 block text-2xl font-bold leading-tight text-app-text">{totalLabel}</strong>
              <span className="mt-1 block text-sm text-app-muted">Total limit — activity does not extend it</span>
            </div>
          </div>
          <p className="mb-0 mt-3 text-sm text-app-muted">You are warned shortly before either limit ends your session.</p>
        </Card>
      </div>
    </div>
  );
}
