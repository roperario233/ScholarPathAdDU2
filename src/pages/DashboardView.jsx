import { AnnouncementItem, Card, EmptyState, NotificationItem, ScholarshipRow, StatCard } from '../components/pageParts';
import { ArrowRight, CalendarDays, CircleAlert } from 'lucide-react';
import { fmtCurrency, fmtDate } from '../lib/formatters';

export default function DashboardView({ profile, isFirstLogin, stats, applications, scholarships, customDeadlines = [], eligibleScholarships, notifications, announcements, onOpenExplorer, onOpenEligibility, onTrackScholarship, onMarkRead, onShowApplications, onOpenCalendar, onOpenAdmin, onOpenReview, hasIncompleteProfile, onCompleteProfile }) {
  // Student Dashboard
  if (profile.role === 'student') {
    const draftApplication = applications.find((entry) => entry.status === 'Draft');
    const reviewApplication = applications.find((entry) => ['Submitted', 'Under Review', 'For Verification'].includes(entry.status));
    const nextAction = hasIncompleteProfile
      ? { label: 'Complete your academic profile', detail: 'Add your program, QPI, income, and student number to improve match accuracy.', action: onCompleteProfile, actionLabel: 'Complete profile', icon: CircleAlert }
      : draftApplication
          ? { label: 'Finish a saved application', detail: `${draftApplication.scholarshipTitle} is saved as a draft and ready for your review.`, action: onShowApplications, actionLabel: 'Open applications', icon: ArrowRight }
          : reviewApplication
            ? { label: 'Check your application status', detail: `${reviewApplication.scholarshipTitle} is currently ${reviewApplication.status.toLowerCase()}.`, action: onShowApplications, actionLabel: 'View application', icon: ArrowRight }
            : { label: 'Explore your scholarship matches', detail: 'Review ranked opportunities and track the scholarships that fit your profile.', action: onOpenExplorer, actionLabel: 'Explore scholarships', icon: ArrowRight };
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
              <button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={onOpenEligibility}>Run eligibility check</button>
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
              <p>{eligibleScholarships[0] ? `Deadline ${fmtDate(eligibleScholarships[0].deadline)}` : 'Adjust your profile inputs.'}</p>
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
            <p className="mt-3 text-xs text-app-muted">{hasDeadlineThisMonth ? 'Highlighted dates have scholarship deadlines or reminders.' : 'No deadlines marked this month.'}</p>
          </button>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card title="Top matches" action={<button className="link-btn" type="button" onClick={onOpenExplorer}>View all matches</button>}>
            <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-2">
              {eligibleScholarships.length ? eligibleScholarships.map((scholarship) => (
                <ScholarshipRow key={scholarship.id} scholarship={scholarship} onApply={onTrackScholarship} />
              )) : <EmptyState title="No eligible matches yet" description="Review the Smart Eligibility Checker on the Scholarships page and confirm your saved profile details." action={<button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={onOpenEligibility}>Check eligibility</button>} />}
            </div>
          </Card>

          <Card title="Notifications & announcements">
            <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-2">
              {notifications.length ? notifications.slice(0, 3).map((entry) => (
                <NotificationItem key={entry.id} entry={entry} onMarkRead={onMarkRead} />
              )) : <EmptyState title="No new alerts" description="Deadline reminders and status updates appear here as you use the app." />}
              {announcements.slice(0, 2).map((entry) => (
                <AnnouncementItem key={entry.id} entry={entry} />
              ))}
            </div>
          </Card>
        </section>
      </div>
    );
  }

  // Admissions Office Dashboard
  if (profile.role === 'admissions_office') {
    return (
      <div className="grid gap-4">
        <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
          <div className="page-title-copy"><span className="page-section-label">Admissions Office workspace</span><h2>Good day, {profile.fullName || 'Administrator'}</h2><p>Coordinate application operations, document verification, announcements, and results through the Standard Procedure.</p></div>
          <button type="button" onClick={onOpenAdmin} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-5 py-2 text-sm font-bold text-white shadow-sm">Open Admissions Office <ArrowRight className="ml-2" size={16} /></button>
        </section>
        <section className="grid gap-4 sm:grid-cols-3"><StatCard label="Applications to review" value={stats.openApplications} note="Submitted and under review" /><StatCard label="Programs available" value={stats.totalPrograms} note="Active scholarship pipelines" /><StatCard label="Unread alerts" value={stats.unreadNotifications} note="Needs attention" /></section>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.62fr)]">
          <article className="rounded-app border border-blue-400/30 bg-gradient-to-br from-blue-500/15 via-app-card to-app-card p-5 shadow-app"><span className="eyebrow text-blue-700 dark:text-blue-200">Today’s priorities</span><h2 className="mt-2 text-xl font-bold">Start with Admissions Office</h2><p className="mt-2 max-w-2xl text-sm text-app-muted">Review the oldest applications first, verify supporting documents, then publish any scholarship updates that students need to see.</p><button type="button" onClick={onOpenAdmin} className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white">Review work queues <ArrowRight className="ml-2" size={16} /></button></article>
          <div className="grid gap-3"><div className="rounded-[18px] border border-app-border bg-app-surface p-4"><span className="text-xs font-semibold uppercase tracking-wide text-app-muted">Role</span><strong className="mt-1 block">Admissions Office Administrator</strong><p className="mt-1 text-sm text-app-muted">Centralized scholarship operations</p></div><div className="rounded-[18px] border border-app-border bg-app-surface p-4"><span className="text-xs font-semibold uppercase tracking-wide text-app-muted">Workspace status</span><strong className="mt-1 block text-emerald-600 dark:text-emerald-300">Ready for review</strong><p className="mt-1 text-sm text-app-muted">Updates are tracked in the notification center.</p></div></div>
        </section>
      </div>
    );
  }

  // Department Chair Dashboard
  if (profile.role === 'department_chair') {
    return (
      <div className="grid gap-4">
        <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
          <div className="page-title-copy">
            <span className="page-section-label">Department Chair workspace</span>
            <h2>{profile.department || 'Department'} endorsements</h2>
            <p>Screen applicants assigned to your department, convene the interview panel, and record department-level recommendations.</p>
          </div>
          <button type="button" onClick={onOpenReview} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-5 py-2 text-sm font-bold text-white">Open review queue <ArrowRight className="ml-2" size={16} /></button>
        </section>
        <section className="grid gap-4 sm:grid-cols-3"><StatCard label="Applicants in review" value={stats.openApplications} note="Pending endorsement" /><StatCard label="Department" value={profile.department} note="Endorsement scope" /><StatCard label="Unread alerts" value={stats.unreadNotifications} note="System notifications" /></section>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.62fr)]"><article className="rounded-app border border-blue-400/30 bg-gradient-to-br from-blue-500/15 via-app-card to-app-card p-5 shadow-app"><span className="eyebrow text-blue-700 dark:text-blue-200">Next step</span><h2 className="mt-2 text-xl font-bold">Review departmental endorsements</h2><p className="mt-2 text-sm text-app-muted">Check academic standing, household income, and recommendations before endorsing qualified GIA applicants.</p><button type="button" onClick={onOpenReview} className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white">Review applicants <ArrowRight className="ml-2" size={16} /></button></article><div className="rounded-[18px] border border-app-border bg-app-surface p-4"><span className="text-xs font-semibold uppercase tracking-wide text-app-muted">Review scope</span><strong className="mt-1 block">{profile.department || 'Your department'}</strong><p className="mt-2 text-sm text-app-muted">Record recommendations within your department’s assigned review scope.</p></div></section>
      </div>
    );
  }

  return null;
}
