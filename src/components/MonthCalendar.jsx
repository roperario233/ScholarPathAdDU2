import { ArrowLeft, ArrowRight } from 'lucide-react';
import { toCalendarDateKey } from '../lib/calendarMarks';

// The month grid shared by the student, Admissions Office, and Department Chair
// calendars. It owns only the calendar mechanics; each page decides what a day
// means by passing `marksByDate` keyed on `toCalendarDateKey(year, month, day)`.
//
// `showMarkDots` keeps the student calendar's single dot exactly as it was, while
// the staff calendars get one tone-coded dot per mark kind (interview, deadline,
// your panel, department interview, recorded decision, office entry).
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PRIMARY_MARK_KINDS = new Set(['deadline', 'interview', 'your-panel', 'department-interview', 'decision', 'office']);
const SECONDARY_MARK_KINDS = new Set(['custom', 'reminder']);

const DOT_TONES = {
  interview: 'bg-sky-500',
  'your-panel': 'bg-blue-600',
  'department-interview': 'bg-slate-400',
  deadline: 'bg-amber-500',
  decision: 'bg-indigo-500',
  office: 'bg-violet-500',
  reminder: 'bg-emerald-500',
  custom: 'bg-emerald-500',
};

// A staff day can carry interviews, a catalog deadline, recorded decisions, and
// office entries at once, so the cell shows up to four tone-coded dots and then
// a "+n" count instead of silently dropping the rest.
const MAX_CELL_DOTS = 4;

export const getCalendarMarkTone = (kind) => DOT_TONES[kind] || 'bg-slate-400';

export function CalendarLegend({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-app-muted">
      {items.map((item) => (
        <span key={item.kind} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${getCalendarMarkTone(item.kind)}`} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export default function MonthCalendar({
  month,
  year,
  onPrevMonth,
  onNextMonth,
  selectedDate = null,
  onSelectDate,
  marksByDate = {},
  showMarkDots = false,
  legend = null,
  className = '',
  ariaLabel = 'Calendar month',
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const days = [];
  for (let index = 0; index < firstDay; index += 1) days.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) days.push(day);

  return (
    <div className={`calendar-grid ${className}`} role="group" aria-label={ariaLabel}>
      <div className="calendar-nav">
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-full border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px hover:bg-app-card focus:outline-none focus:ring-4 focus:ring-blue-500/20"
          onClick={onPrevMonth}
          aria-label="Previous month"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="m-0 text-center text-xl font-bold tracking-tight text-app-text" aria-live="polite">{monthName}</h3>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-full border border-app-border bg-app-surface text-app-text transition hover:-translate-y-px hover:bg-app-card focus:outline-none focus:ring-4 focus:ring-blue-500/20"
          onClick={onNextMonth}
          aria-label="Next month"
        >
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((day) => (
          <div key={day} className="calendar-day-label">{day}</div>
        ))}
      </div>

      <div className="calendar-days">
        {days.map((day, index) => {
          if (!day) {
            return <button key={`empty-${index}`} type="button" className="calendar-cell empty" disabled aria-hidden="true" />;
          }
          const marks = marksByDate[toCalendarDateKey(year, month, day)] || [];
          const hasMarks = marks.length > 0;
          const hasPrimary = marks.some((mark) => PRIMARY_MARK_KINDS.has(mark.kind));
          const hasSecondary = marks.some((mark) => SECONDARY_MARK_KINDS.has(mark.kind));
          const isSelected = selectedDate === day;
          const isToday = isCurrentMonth && today.getDate() === day;
          const markLabel = marks.map((mark) => mark.label).filter(Boolean).join(', ');
          return (
            <button
              key={day}
              type="button"
              className={`calendar-cell active ${hasPrimary ? 'has-deadline' : ''} ${hasSecondary ? 'has-custom-deadline' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => onSelectDate?.(isSelected ? null : day)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={markLabel ? `${day} — ${markLabel}` : `${day}`}
            >
              {day}
              {hasMarks && !showMarkDots && <span className="deadline-dot" />}
              {hasMarks && showMarkDots && (
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5">
                  {marks.slice(0, MAX_CELL_DOTS).map((mark) => (
                    <span key={mark.kind} className={`h-1.5 w-1.5 rounded-full ${getCalendarMarkTone(mark.kind)}`} />
                  ))}
                  {marks.length > MAX_CELL_DOTS ? (
                    <span className="text-[9px] font-semibold leading-none text-app-muted">+{marks.length - MAX_CELL_DOTS}</span>
                  ) : null}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {legend}
    </div>
  );
}
