import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarPlus, PartyPopper, X } from 'lucide-react';
import { fmtDate } from '../lib/formatters';

const daysLeftLabel = (value) => {
  if (value < 0) return 'Closed';
  if (value === 0) return 'Due today';
  if (value === 1) return '1 day';
  return `${value} days`;
};

export default function CalendarView({ scholarships, customDeadlines = [], onAddCustomDeadline, onDeleteCustomDeadline, syncFeedback, onDismissSyncFeedback }) {
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

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const daysInMonth = getDaysInMonth(displayYear, displayMonth);
  const firstDay = getFirstDayOfMonth(displayYear, displayMonth);
  const monthName = new Date(displayYear, displayMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
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

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <div className="grid gap-4">
      <section className="page-title-bar rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="page-title-copy">
          <span className="page-section-label">Deadline calendar</span>
          <h2>Scholarship deadlines and personal reminders</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Track scholarship deadlines alongside your own document and essay reminders.</p>
        </div>
        {syncFeedback?.message && (
          <div
            className={`mt-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
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
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="calendar-grid">
            <div className="calendar-nav">
              <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={handlePrevMonth} aria-label="Previous month"><ArrowLeft size={18} /></button>
              <h3 className="m-0 text-center text-lg font-semibold text-app-text">{monthName}</h3>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-xl border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={handleNextMonth} aria-label="Next month"><ArrowRight size={18} /></button>
            </div>
            <div className="calendar-weekdays">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="calendar-day-label">{day}</div>
              ))}
            </div>
            <div className="calendar-days">
              {days.map((day, idx) => {
                const dayScholarships = getScholarshipsForDate(day);
                const dayCustomDeadlines = getCustomDeadlinesForDate(day);
                const hasDeadlines = dayScholarships.length > 0 || dayCustomDeadlines.length > 0;
                const isSelected = selectedDate === day;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`calendar-cell ${day ? 'active' : 'empty'} ${dayScholarships.length > 0 ? 'has-deadline' : ''} ${dayCustomDeadlines.length > 0 ? 'has-custom-deadline' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => day && setSelectedDate(isSelected ? null : day)}
                    disabled={!day}
                    aria-label={day ? `${day}${hasDeadlines ? ` - ${dayScholarships.length} scholarship${dayScholarships.length !== 1 ? 's' : ''} and ${dayCustomDeadlines.length} custom deadline${dayCustomDeadlines.length !== 1 ? 's' : ''}` : ''}` : undefined}
                  >
                    {day}
                    {hasDeadlines && <span className="deadline-dot" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid content-start gap-4 rounded-[18px] border border-app-border bg-app-surface p-4">
            <div className="upcoming-deadlines-header">
              <h3>{selectedDate ? `Deadlines on ${new Date(displayYear, displayMonth, selectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Upcoming Deadlines'}</h3>
              {!selectedDate && (
                <button type="button" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={() => setShowAddForm(!showAddForm)}>
                  {showAddForm ? 'Cancel' : <><CalendarPlus size={16} /> Add Reminder</>}
                </button>
              )}
            </div>
            {selectedDate ? (
              selectedDateScholarships.length || getCustomDeadlinesForDate(selectedDate).length ? (
                <div className="deadline-list">
                  {selectedDateScholarships.map((scholarship) => {
                    const daysUntil = Math.ceil((new Date(scholarship.deadline) - now) / (1000 * 60 * 60 * 24));
                    const urgency = daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'info';
                    return (
                      <div key={scholarship.id} className={`deadline-item ${urgency}`}>
                        <div>
                          <strong>{scholarship.title}</strong>
                          <p>{fmtDate(scholarship.deadline)}</p>
                        </div>
                        <span className="days-left">{daysLeftLabel(daysUntil)}</span>
                      </div>
                    );
                  })}
                  {getCustomDeadlinesForDate(selectedDate).map((customDeadline) => {
                    const daysUntil = Math.ceil((new Date(customDeadline.deadline) - now) / (1000 * 60 * 60 * 24));
                    const urgency = daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'info';
                    return (
                      <div key={customDeadline.id} className={`deadline-item custom-deadline ${urgency}`}>
                        <div>
                          <strong>{customDeadline.title}</strong>
                          <p>{fmtDate(customDeadline.deadline)}</p>
                        </div>
                        <div className="deadline-actions">
                          <span className="days-left">{daysLeftLabel(daysUntil)}</span>
                          <button
                            type="button"
                            className="delete-deadline-btn"
                            onClick={() => onDeleteCustomDeadline(customDeadline.id)}
                            aria-label="Delete deadline"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="no-deadlines">No deadlines on this date</p>
              )
            ) : (
              upcomingDeadlines.length ? (
                <div className="deadline-list">
                  {upcomingDeadlines.map((scholarship) => {
                    const daysUntil = Math.ceil((new Date(scholarship.deadline) - now) / (1000 * 60 * 60 * 24));
                    const urgency = daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'info';
                    return (
                      <div key={scholarship.id} className={`deadline-item ${urgency}`}>
                        <div>
                          <strong>{scholarship.title}</strong>
                          <p>{fmtDate(scholarship.deadline)}</p>
                        </div>
                        <span className="days-left">{daysLeftLabel(daysUntil)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="no-deadlines">No upcoming deadlines <PartyPopper size={16} aria-hidden="true" /></p>
              )
            )}
          </div>
        </div>
      </section>

      {showAddForm && !selectedDate && (
        <div className="deadline-modal-backdrop" role="presentation" onClick={() => setShowAddForm(false)}>
          <div className="w-[min(100%,34rem)] rounded-app border bg-app-card p-5 shadow-app backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="deadline-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="deadline-modal-head">
              <div>
                <span className="eyebrow">Custom reminder</span>
                <h3 id="deadline-modal-title">Add your own deadline</h3>
                <p>Use this for document preparation, essay drafting, and other tasks that need a reminder before a deadline.</p>
              </div>
              <button type="button" className="deadline-modal-close" onClick={() => setShowAddForm(false)} aria-label="Close reminder modal">
                <X size={18} />
              </button>
            </div>

            <form className="add-deadline-form" onSubmit={handleAddDeadline}>
              <label>
                <span>Reminder title</span>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Gather documents"
                  required
                />
              </label>
              <label>
                <span>Deadline date</span>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  min={todayInputValue}
                  required
                />
              </label>
              <p className="deadline-form-note">Choose today or a future date. In-app reminders can be sent 7, 3, and 1 day before the deadline.</p>
              {formError && <p className="deadline-form-error">{formError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { setShowAddForm(false); setFormError(''); }}>Cancel</button>
                <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" disabled={!formTitle.trim() || !formDate || formDate < todayInputValue}>Create Reminder</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
