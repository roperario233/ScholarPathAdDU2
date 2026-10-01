import { useState } from 'react';
import { Button } from '../components/ui';

function SettingToggle({ checked, onChange, title, description }) {
  return (
    <label className="group flex cursor-pointer items-start gap-4 rounded-xl bg-app-surface p-4 transition-colors hover:bg-app-card">
      <span className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-slate-400/20 transition-colors has-[:checked]:bg-ateneo">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="pointer-events-none absolute bottom-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-app-text">{title}</strong>
        <span className="mt-1 block text-sm text-app-muted">{description}</span>
      </span>
    </label>
  );
}

export default function SettingsView({ notificationPreferences, onUpdatePreferences, isEmailDeliveryAvailable = false, onSendTestEmail }) {
  const [testEmail, setTestEmail] = useState({ status: 'idle', message: '' });
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

  return (
    <div className="grid gap-4">
      <section className="page-title-bar rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="page-title-copy">
          <span className="page-section-label">Settings</span>
          <h2>Notification center settings</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Choose how ScholarPath reaches you and when deadline reminders should arrive.</p>
        </div>

        <div className="mt-8 border-t border-app-border pt-6">
          <h3 className="m-0 text-lg font-semibold text-app-text">Notification Channels</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SettingToggle
              checked={preferences.smsEnabled}
              onChange={(value) => updatePreference('smsEnabled', value)}
              title="SMS Notifications"
              description="Receive deadline alerts and status updates via text message"
            />
            <SettingToggle
              checked={preferences.emailEnabled}
              onChange={(value) => updatePreference('emailEnabled', value)}
              title="Email Notifications"
              description="Emailed deadline reminders and application status updates"
            />
            <SettingToggle
              checked={preferences.inAppEnabled}
              onChange={(value) => updatePreference('inAppEnabled', value)}
              title="In-App Notifications"
              description="See updates and alerts when you're logged in"
            />
          </div>

          {onSendTestEmail ? (
            <div className="mt-4 rounded-xl border border-app-border bg-app-card p-4">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold text-app-text">Email delivery test</strong>
                  <span className="mt-1 block text-sm text-app-muted">
                    Send one email to your own address to confirm delivery. Scheduled reminders and status updates use the same channel.
                  </span>
                </div>
                <Button type="button" variant="primary" onClick={handleSendTestEmail} disabled={testEmail.status === 'sending'}>
                  {testEmail.status === 'sending' ? 'Sending…' : 'Send test email'}
                </Button>
              </div>
              {testEmail.message && (
                <p
                  className={`mt-3 text-sm ${testEmail.status === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}
                  role="status"
                >
                  {testEmail.message}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-app-muted">
              {isEmailDeliveryAvailable
                ? 'Email delivery is available, but the test sender is not wired up on this build.'
                : 'Email delivery activates once the Supabase workspace is configured for this prototype.'}
            </p>
          )}
        </div>

        <div className="mt-8 border-t border-app-border pt-6">
          <h3 className="m-0 text-lg font-semibold text-app-text">Deadline Reminders</h3>
          <p className="mb-0 mt-2 text-sm text-app-muted">Choose when you want to be reminded about upcoming deadlines.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SettingToggle
              checked={preferences.deadlineReminders.oneWeekBefore}
              onChange={(value) => updateDeadlineReminder('oneWeekBefore', value)}
              title="1 Week Before"
              description="Get reminded 7 days before a deadline"
            />
            <SettingToggle
              checked={preferences.deadlineReminders.threeDaysBefore}
              onChange={(value) => updateDeadlineReminder('threeDaysBefore', value)}
              title="3 Days Before"
              description="Get a reminder 3 days before a deadline"
            />
            <SettingToggle
              checked={preferences.deadlineReminders.dayBefore}
              onChange={(value) => updateDeadlineReminder('dayBefore', value)}
              title="Day Before"
              description="Get a final reminder the day before"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
