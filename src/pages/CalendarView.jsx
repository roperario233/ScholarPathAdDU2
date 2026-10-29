import { useEffect, useState } from 'react';
import { BellRing, CalendarCheck, CalendarClock, CalendarPlus, Flag, PartyPopper, Video, X } from 'lucide-react';
import { Button, FormField, ModalShell, StatusBadge } from '../components/ui';
import { fmtDate } from '../lib/formatters';
import { aggregateCalendarMarks, toCalendarDateKey } from '../lib/calendarMarks';
import MonthCalendar, { CalendarLegend } from '../components/MonthCalendar';
import { formatInterviewWhen, getInterviewDateKey, getInterviewEndsAt, isStructuredInterview } from '../lib/interview';

const DAY_MS = 1000 * 60 * 60 * 24;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const daysLeftLabel = (value) => {
  if (value < 0) return 'Closed';
  if (value === 0) return 'Due today';
  if (value === 1) return '1 day';
  return `${value} days`;
};

const getUrgency = (daysUntil) => {
  if (daysUntil < 0) return 'closed';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 7) return 'warning';
  return 'info';
};

// Date-block and days-left colours per urgency, readable in both themes.
const URGENCY_STYLES = {
  urgent: { block: 'bg-rose-500/15 text-rose-700 dark:text-rose-200', badge: 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200', bar: 'before:bg-rose-500' },
  warning: { block: 'bg-amber-500/15 text-amber-700 dark:text-amber-200', badge: 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200', bar: 'before:bg-amber-500' },
  info: { block: 'bg-blue-500/15 text-blue-700 dark:text-blue-200', badge: 'border-blue-400/40 bg-blue-500/10 text-blue-700 dark:text-blue-200', bar: 'before:bg-blue-500' },
  closed: { block: 'bg-slate-500/15 text-app-muted', badge: 'border-app-border bg-app-surface text-app-muted', bar: 'before:bg-slate-400' },
};

const pad = (value) => String(value).padStart(2, '0');

const getDateParts = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { month: '—', day: '' };
  return { month: MONTH_SHORT[date.getMonth()], day: date.getDate() };
};

// An interview is filed on its Manila date key, so the block reads that key
// instead of the browser's local day.
const getKeyParts = (dateKey) => {
  const [, month, day] = String(dateKey || '').split('-').map(Number);
  return { month: MONTH_SHORT[(month || 1) - 1] || '—', day: day || '' };
};

function AgendaItem({ kind = 'deadline', parts, title, subtitle, badge, urgency = 'info', onDelete = null }) {
  const styles = URGENCY_STYLES[urgency] || URGENCY_STYLES.info;
  const KindIcon = kind === 'interview' ? Video : kind === 'custom' ? BellRing : Flag;
  const kindLabel = kind === 'interview' ? 'Interview' : kind === 'custom' ? 'Your reminder' : 'Scholarship deadline';
  return (
    <div className={`relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-app-border bg-app-card p-3 pl-4 transition hover:-translate-y-px hover:shadow-card before:absolute before:inset-y-0 before:left-0 before:w-1 ${kind === 'interview' ? 'before:bg-sky-500' : kind === 'custom' ? 'before:bg-violet-500' : styles.bar}`}>
      <div className={`grid h-12 w-12 shrink-0 place-content-center rounded-xl text-center leading-none ${kind === 'interview' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-200' : kind === 'custom' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200' : styles.block}`} aria-hidden="true">
        <span className="text-[0.65rem] font-bold uppercase tracking-wider">{parts.month}</span>
        <span className="mt-0.5 text-lg font-extrabold">{parts.day}</span>
      </div>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-semibold text-app-text" title={title}>{title}</strong>
        <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-app-muted">
          <KindIcon size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{kindLabel} · {subtitle}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${kind === 'interview' ? 'border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-200' : styles.badge}`}>{badge}</span>
        {onDelete && (
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-rose-400/30 bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20 focus:outline-none focus:ring-4 focus:ring-rose-500/20 dark:text-rose-300"
            onClick={onDelete}
            aria-label={`Delete reminder ${title}`}
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function InterviewItem({ interview }) {
  return (
    <AgendaItem
      kind="interview"
      parts={getKeyParts(interview.dateKey)}
      title={`Interview · ${interview.title}`}
      subtitle={interview.when}
      badge={interview.modeLabel}
    />
  );
}

function SummaryTile({ icon: Icon, label, value, note }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-app-border bg-app-surface/70 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-app-muted-surface text-blue-600 dark:text-blue-300" aria-hidden="true"><Icon size={18} /></span>
      <div className="min-w-0">
        <span className="block text-xs font-semibold text-app-muted">{label}</span>
        <strong className="block truncate text-base font-bold text-app-text" title={String(value)}>{value}</strong>
        {note ? <span className="block truncate text-xs text-app-muted">{note}</span> : null}
      </div>
    </div>
  );
}

const LEGEND_ITEMS = [
  { kind: 'deadline', label: 'Scholarship deadline' },
  { kind: 'custom', label: 'Your reminder' },
  { kind: 'interview', label: 'Interview' },
];

export default function CalendarView({ scholarships, customDeadlines = [], interviews = [], onAddCustomDeadline, onDeleteCustomDeadline, syncFeedback, onDismissSyncFeedback }) {
  const now = new Date();
  const todayInputValue = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [displayMonth, setDisplayMonth] = useState(now.getMonth());
  const [displayYear, setDisplayYear] = useState(now.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (showAddForm) {
      setFormDate(todayInputValue);
      setFormError('');
    }
  }, [showAddForm, todayInputValue]);

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
    setSelectedDate(null);
  };

  // Scheduled interviews (SOP step 5) appear on the student's calendar on their
  // Manila date. `interviews` is the student's own applications.
  const scheduledInterviews = interviews
    .filter((entry) => entry.status === 'Interview' && isStructuredInterview(entry.interview) && entry.interview.state === 'scheduled')
    .map((entry) => ({
      id: entry.id,
      title: entry.scholarshipTitle || 'Scholarship',
      dateKey: getInterviewDateKey(entry.interview.startsAt),
      endsAt: getInterviewEndsAt(entry.interview),
      startsAt: entry.interview.startsAt,
      when: formatInterviewWhen(entry.interview.startsAt, entry.interview.durationMinutes),
      modeLabel: entry.interview.mode === 'online' ? 'Online' : 'On-site',
    }))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const upcomingInterviews = scheduledInterviews.filter((entry) => entry.endsAt && entry.endsAt >= now);
  const getInterviewsForDate = (day) => {
    if (!day) return [];
    const key = `${displayYear}-${pad(displayMonth + 1)}-${pad(day)}`;
    return scheduledInterviews.filter((entry) => entry.dateKey === key);
  };

  const upcomingDeadlines = scholarships
    .filter((s) => new Date(s.deadline) >= now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 5);

  const getScholarshipsForDate = (day) => {
    if (!day) return [];
    const date = new Date(displayYear, displayMonth, day);
    return scholarships.filter(
      (s) => new Date(s.deadline).toDateString() === date.toDateString()
    );
  };

  const getCustomDeadlinesForDate = (day) => {
    if (!day) return [];
    const date = new Date(displayYear, displayMonth, day);
    return customDeadlines.filter(
      (d) => new Date(d.deadline).toDateString() === date.toDateString()
    );
  };

  const openAddForm = () => {
    setShowAddForm(true);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setFormError('');
  };

  const handleAddDeadline = (e) => {
    e.preventDefault();
    const normalizedTitle = formTitle.trim();

    if (!normalizedTitle) {
      setFormError('Please add a reminder title.');
      return;
    }

    if (!formDate || formDate < todayInputValue) {
      setFormError('Choose today or a future date.');
      return;
    }

    onAddCustomDeadline(normalizedTitle, formDate);
    setFormTitle('');
    setFormDate(todayInputValue);
    setFormError('');
    setShowAddForm(false);
  };

  const selectedDateScholarships = selectedDate ? getScholarshipsForDate(selectedDate) : [];
  const selectedDateCustom = selectedDate ? getCustomDeadlinesForDate(selectedDate) : [];
  const selectedDateInterviews = selectedDate ? getInterviewsForDate(selectedDate) : [];

  // The month grid only needs one mark per kind per day. The agenda below keeps
  // reading the per-item lists, so the calendar's appearance is unchanged.
  const rawMarks = {};
  const addMark = (key, kind) => {
    if (!key) return;
    rawMarks[key] = [...(rawMarks[key] || []), { kind, count: 1 }];
  };
  scholarships.forEach((entry) => {
    const date = new Date(entry.deadline);
    if (!Number.isNaN(date.getTime())) {
      addMark(toCalendarDateKey(date.getFullYear(), date.getMonth(), date.getDate()), 'deadline');
    }
  });
  customDeadlines.forEach((entry) => {
    const date = new Date(entry.deadline);
    if (!Number.isNaN(date.getTime())) {
      addMark(toCalendarDateKey(date.getFullYear(), date.getMonth(), date.getDate()), 'custom');
    }
  });
  scheduledInterviews.forEach((entry) => addMark(entry.dateKey, 'interview'));
  const marksByDate = Object.fromEntries(
    Object.entries(rawMarks).map(([key, marks]) => [key, aggregateCalendarMarks(marks)]),
  );

  // Summary strip: what is coming up next, across deadlines and reminders.
  const daysUntil = (value) => Math.ceil((new Date(value) - now) / DAY_MS);
  const nextDeadline = upcomingDeadlines[0] || null;
  const dueThisWeek = [...scholarships, ...customDeadlines].filter((entry) => {
    const value = daysUntil(entry.deadline);
    return new Date(entry.deadline) >= now && value >= 0 && value <= 7;
  }).length;
  const upcomingReminders = customDeadlines.filter((entry) => new Date(entry.deadline) >= now).length;

  const renderScholarshipItem = (scholarship) => {
    const remaining = daysUntil(scholarship.deadline);
    return (
      <AgendaItem
        key={scholarship.id}
        parts={getDateParts(scholarship.deadline)}
        title={scholarship.title}
        subtitle={fmtDate(scholarship.deadline)}
        badge={daysLeftLabel(remaining)}
        urgency={getUrgency(remaining)}
      />
    );
  };

  const renderCustomItem = (customDeadline) => {
    const remaining = daysUntil(customDeadline.deadline);
    return (
      <AgendaItem
        key={customDeadline.id}
        kind="custom"
        parts={getDateParts(customDeadline.deadline)}
        title={customDeadline.title}
        subtitle={fmtDate(customDeadline.deadline)}
        badge={daysLeftLabel(remaining)}
        urgency={getUrgency(remaining)}
        onDelete={() => onDeleteCustomDeadline(customDeadline.id)}
      />
    );
  };

  return (
    <div className="grid gap-4">
      <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="page-title-copy">
            <span className="page-section-label">Deadline calendar</span>
            <h2>Scholarship deadlines and personal reminders</h2>
            <p className="mt-2 max-w-2xl text-sm text-app-muted">Track scholarship deadlines alongside your own document and essay reminders.</p>
          </div>
          <Button type="button" variant="primary" className="w-full gap-2 sm:w-auto" onClick={openAddForm}>
            <CalendarPlus size={16} aria-hidden="true" /> Add Reminder
          </Button>
        </div>
        {syncFeedback?.message && (
          <div
            className={`relative mt-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
              syncFeedback.tone === 'error'
                ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                : syncFeedback.tone === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
            }`}
            role="status"
          >
            <span className="min-w-0">{syncFeedback.message}</span>
            {onDismissSyncFeedback && (
              <button
                type="button"
                className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                onClick={onDismissSyncFeedback}
                aria-label="Dismiss reminder sync message"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="relative mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile icon={CalendarClock} label="Next deadline" value={nextDeadline ? nextDeadline.title : 'None upcoming'} note={nextDeadline ? `${fmtDate(nextDeadline.deadline)} · ${daysLeftLabel(daysUntil(nextDeadline.deadline))}` : 'You are all caught up'} />
          <SummaryTile icon={Flag} label="Due in 7 days" value={dueThisWeek} note={dueThisWeek === 1 ? 'deadline or reminder' : 'deadlines and reminders'} />
          <SummaryTile icon={BellRing} label="Your reminders" value={upcomingReminders} note="Arrive 7, 3, and 1 day before" />
          <SummaryTile icon={CalendarCheck} label="Interviews" value={upcomingInterviews.length} note={upcomingInterviews.length ? upcomingInterviews[0].when : 'None scheduled'} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="rounded-app border bg-app-card p-4 shadow-app backdrop-blur sm:p-5">
          <MonthCalendar
            month={displayMonth}
            year={displayYear}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            marksByDate={marksByDate}
            legend={<CalendarLegend items={LEGEND_ITEMS} />}
            ariaLabel="Scholarship deadline calendar"
          />
        </div>

        <div className="grid content-start gap-4 rounded-app border bg-app-card p-4 shadow-app backdrop-blur sm:p-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="page-section-label">{selectedDate ? 'Selected day' : 'Agenda'}</span>
              <h3 className="m-0 mt-1 text-lg font-bold text-app-text">
                {selectedDate ? new Date(displayYear, displayMonth, selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Upcoming deadlines'}
              </h3>
            </div>
            {selectedDate && (
              <Button type="button" variant="ghost" className="shrink-0 !min-h-9 !px-3" onClick={() => setSelectedDate(null)}>
                Show upcoming
              </Button>
            )}
          </div>
          {selectedDate ? (
            selectedDateScholarships.length || selectedDateCustom.length || selectedDateInterviews.length ? (
              <div className="grid gap-3">
                {selectedDateInterviews.map((interview) => <InterviewItem key={interview.id} interview={interview} />)}
                {selectedDateScholarships.map(renderScholarshipItem)}
                {selectedDateCustom.map(renderCustomItem)}
              </div>
            ) : (
              <p className="m-0 rounded-2xl border border-dashed border-app-border bg-app-surface/60 px-4 py-8 text-center text-sm text-app-muted">Nothing is due on this date.</p>
            )
          ) : (
            upcomingDeadlines.length || upcomingInterviews.length ? (
              <div className="grid gap-3">
                {upcomingInterviews.map((interview) => <InterviewItem key={interview.id} interview={interview} />)}
                {upcomingDeadlines.map(renderScholarshipItem)}
              </div>
            ) : (
              <p className="m-0 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app-border bg-app-surface/60 px-4 py-8 text-center text-sm text-app-muted">No upcoming deadlines <PartyPopper size={16} aria-hidden="true" /></p>
            )
          )}
          {!selectedDate && customDeadlines.length > 0 && (
            <div className="grid gap-3 border-t border-app-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Your reminders</h4>
                <StatusBadge tone="neutral">{customDeadlines.length}</StatusBadge>
              </div>
              {[...customDeadlines]
                .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
                .slice(0, 5)
                .map(renderCustomItem)}
            </div>
          )}
        </div>
      </section>

      {showAddForm && (
        <ModalShell
          title="Add your own deadline"
          onClose={closeAddForm}
          className="w-[min(100%,34rem)]"
          header={(
            <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="page-section-label">Custom reminder</span>
                <h3 className="m-0 mt-1 text-xl font-bold text-app-text">Add your own deadline</h3>
                <p className="mb-0 mt-1 text-sm text-app-muted">Use this for document prep, essays, or other tasks.</p>
              </div>
              <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={closeAddForm} aria-label="Close reminder modal">
                <X size={18} />
              </button>
            </div>
          )}
        >
          <form className="grid gap-4" onSubmit={handleAddDeadline}>
            <FormField label="Reminder title">
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Gather documents"
                required
                autoFocus
              />
            </FormField>
            <FormField label="Deadline date" hint="Choose today or a future date. Reminders can arrive 7, 3, and 1 day before.">
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                min={todayInputValue}
                required
              />
            </FormField>
            {formError && <p className="m-0 text-sm font-semibold text-rose-600 dark:text-rose-300" role="alert">{formError}</p>}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" onClick={closeAddForm}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!formTitle.trim() || !formDate || formDate < todayInputValue}>Create Reminder</Button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
