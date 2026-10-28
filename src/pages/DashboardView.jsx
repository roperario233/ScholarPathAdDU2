import { AnnouncementItem, Card, EmptyState, NotificationItem, ScholarshipRow } from '../components/pageParts';
import { ArrowRight, CalendarDays, CircleAlert } from 'lucide-react';
import { fmtCurrency, fmtDate } from '../lib/formatters';

// The student Dashboard. Staff, head, and Department Chair roles have their own
// landing workspaces (the Admissions Office Dashboard and Department Review), so
// this page is never rendered for them.
export default function DashboardView({ profile, isFirstLogin, applications, scholarships, customDeadlines = [], eligibleScholarships, notifications, announcements, onOpenExplorer, onOpenEligibility, onTrackScholarship, onMarkRead, onShowApplications, onContinueApplication, onOpenCalendar, hasIncompleteProfile, onCompleteProfile }) {
  // Student Dashboard
  if (profile.role === 'student') {
    const draftApplication = applications.find((entry) => entry.status === 'Draft');
    const reviewApplication = applications.find((entry) => ['Submitted', 'Under Review', 'For Verification'].includes(entry.status));
    const nextAction = hasIncompleteProfile
      ? { label: 'Complete your academic profile', detail: 'Add your academic and financial details to improve matches.', action: onCompleteProfile, actionLabel: 'Complete profile', icon: CircleAlert }
      : draftApplication
          ? { label: 'Finish a saved application', detail: `${draftApplication.scholarshipTitle} is a draft. Attach its documents and submit.`, action: () => (onContinueApplication ? onContinueApplication(draftApplication.id) : onShowApplications()), actionLabel: 'Continue application', icon: ArrowRight }
          : reviewApplication
            ? { label: 'Check your application status', detail: `${reviewApplication.scholarshipTitle} is ${reviewApplication.status.toLowerCase()}.`, action: onShowApplications, actionLabel: 'View application', icon: ArrowRight }
            : { label: 'Explore your scholarship matches', detail: 'Review opportunities that fit your profile.', action: onOpenExplorer, actionLabel: 'Explore scholarships', icon: ArrowRight };
    const NextActionIcon = nextAction.icon;
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const deadlineDates = new Set([
      ...scholarships.map((entry) => entry.deadline),
      ...customDeadlines.map((entry) => entry.deadline),
    ].filter(Boolean).map((deadline) => String(deadline).slice(0, 10)));
    const calendarDays = Array.from({ length: monthStart.getDay() + daysInMonth }, (_, index) => {
      const day = index - monthStart.getDay() + 1;
      return day > 0 && day <= daysInMonth ? day : null;
    });
    const calendarDateKey = (day) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasDeadlineThisMonth = calendarDays.some((day) => day && deadlineDates.has(calendarDateKey(day)));

    return (
      <div className="blue-action-view grid gap-4">
        <section className="dashboard-hero grid gap-6 rounded-app border bg-app-card p-5 shadow-app backdrop-blur lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:p-7">
          <div className="dashboard-hero-copy">
            <p className="dashboard-welcome">{isFirstLogin ? 'Welcome!' : `Welcome back, ${profile.fullName || 'Scholar'}!`}</p>
            <h1>Find the right scholarship and take the next step.</h1>
            <div className="flex flex-wrap items-center gap-3">
              <button className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={onOpenExplorer}>Explore scholarships</button>
            </div>
          </div>
          <div className="dashboard-hero-summary grid content-start gap-3">
            <div className="dashboard-summary-card rounded-[18px] border border-app-border bg-app-surface p-4">
              <span>Student profile</span>
              <strong>{profile.degreeProgram}</strong>
              <p>QPI {profile.qpi ?? '—'} · Income {profile.householdIncome ? fmtCurrency(profile.householdIncome) : '—'}</p>
            </div>
            <div className="dashboard-summary-card rounded-[18px] border border-app-border bg-app-surface p-4">
              <span>Best match</span>
              <strong>{eligibleScholarships[0]?.title ?? 'No matches yet'}</strong>
              <p>{eligibleScholarships[0] ? `Deadline ${fmtDate(eligibleScholarships[0].deadline)}` : 'Adjust your Application Form answers.'}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.45fr)]">
          <article className="rounded-app border border-blue-400/30 bg-gradient-to-br from-blue-500/15 via-app-card to-app-card p-5 shadow-app">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="eyebrow text-blue-700 dark:text-blue-200">Your next best action</span>
                <h2 className="mt-2 text-xl font-bold text-app-text">{nextAction.label}</h2>
                <p className="mt-2 max-w-2xl text-sm text-app-muted">{nextAction.detail}</p>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-500/15 text-blue-600 dark:text-blue-200"><NextActionIcon size={21} aria-hidden="true" /></span>
            </div>
            <button type="button" className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={nextAction.action}>{nextAction.actionLabel}<ArrowRight size={16} aria-hidden="true" /></button>
          </article>
          <button type="button" onClick={onOpenCalendar} className="rounded-app border border-app-border bg-app-card p-4 text-left shadow-app transition hover:-translate-y-px hover:shadow-app focus:outline-none focus:ring-4 focus:ring-blue-500/20" aria-label="Open deadline calendar">
            <div className="flex items-center justify-between gap-3"><div><span className="eyebrow">Deadlines</span><h2 className="mt-1 text-lg font-bold text-app-text">{today.toLocaleDateString('en-US', { month: 'long' })}</h2></div><CalendarDays className="text-blue-500" size={22} aria-hidden="true" /></div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-app-muted">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
            <div className="mt-1 grid grid-cols-7 gap-1 text-center text-xs">
              {calendarDays.map((day, index) => {
                const hasDeadline = day && deadlineDates.has(calendarDateKey(day));
                const isToday = day === today.getDate();
                return <span key={`${day || 'blank'}-${index}`} className={`relative grid aspect-square place-items-center rounded-md ${!day ? '' : isToday ? 'bg-blue-500 font-bold text-white' : hasDeadline ? 'bg-amber-400/20 font-bold text-amber-700 dark:text-amber-200' : 'text-app-text'}`}>{day}{hasDeadline && !isToday && <i className="absolute bottom-0.5 h-1 w-1 rounded-full bg-amber-500" aria-hidden="true" />}</span>;
              })}
            </div>
            <p className="mt-3 text-xs text-app-muted">{hasDeadlineThisMonth ? 'Highlighted dates have deadlines or reminders.' : 'No deadlines this month.'}</p>
          </button>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card title="Top matches" action={<button className="link-btn" type="button" onClick={onOpenExplorer}>View all matches</button>}>
            <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-2">
              {eligibleScholarships.length ? eligibleScholarships.map((scholarship) => (
                <ScholarshipRow key={scholarship.id} scholarship={scholarship} onApply={onTrackScholarship} profile={profile} />
              )) : <EmptyState title="No eligible matches yet" description="Check the Smart Eligibility Checker and your saved profile." action={<button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={onOpenEligibility}>Check eligibility</button>} />}
            </div>
          </Card>

          <Card title="Notifications & announcements">
            <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-2">
              {notifications.length ? notifications.slice(0, 3).map((entry) => (
                <NotificationItem key={entry.id} entry={entry} onMarkRead={onMarkRead} />
              )) : <EmptyState title="No new alerts" description="Deadline reminders and status updates appear here." />}
              {announcements.slice(0, 2).map((entry) => (
                <AnnouncementItem key={entry.id} entry={entry} />
              ))}
            </div>
          </Card>
        </section>
      </div>
    );
  }

  return null;
}
