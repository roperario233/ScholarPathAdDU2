import { getCaseCardClass } from './pageParts';
import { Button, StatusBadge } from './ui';
import { getInterviewStateLabel } from '../lib/interview';
import { formatInterviewTimeRange } from '../lib/interviewRoster';

// One roster row, shared by the Admissions Office and Department Chair interview
// pages. Presentation only: every write goes back through the page, which routes
// it to the shared ApplicationReviewModal.
const STATE_TONES = { scheduled: 'info', completed: 'success', no_show: 'warning', cancelled: 'danger' };

export const getInterviewStateTone = (state) => STATE_TONES[state] || 'neutral';

// "Tuesday, November 3, 2026" from a Manila day key. Built from the parts so the
// heading cannot shift to the previous day outside Asia/Manila.
export const formatInterviewDay = (dateKey) => {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return dateKey || '';
  return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const describePanel = (panel = []) => (
  panel.length
    ? panel.map((member) => `${member.name}${member.isLead ? ' (Lead)' : ''}`).join(' · ')
    : 'No panel yet'
);

export function InterviewRosterRow({
  entry,
  panel = [],
  notesCount = 0,
  yourRole = null,
  onOpen,
  openLabel = 'Open interview',
}) {
  const where = entry.mode === 'online'
    ? (entry.meetingUrl
      ? <a href={entry.meetingUrl} target="_blank" rel="noreferrer" className="underline">Online · Join meeting</a>
      : 'Online · link to follow')
    : (entry.locationLabel || 'Location to be announced');

  return (
    <article className={getCaseCardClass(getInterviewStateTone(entry.state))}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base">{entry.studentName}</h3>
          <p className="mt-0.5 text-sm text-app-muted">
            {entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}
          </p>
          <p className="mt-0.5 text-xs text-app-muted">
            {formatInterviewTimeRange(entry)} · {where}
          </p>
          <p className="mt-0.5 truncate text-xs text-app-muted">
            {describePanel(panel)}
            {notesCount ? ` · ${notesCount} note${notesCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusBadge tone={getInterviewStateTone(entry.state)}>{getInterviewStateLabel(entry.state)}</StatusBadge>
            {entry.revision > 1 ? <StatusBadge tone="warning">Rescheduled</StatusBadge> : null}
            {entry.status === 'Interview' && entry.state === 'scheduled' && !panel.length ? <StatusBadge tone="warning">No panel</StatusBadge> : null}
            {!entry.live && entry.state === 'scheduled' ? <StatusBadge tone="neutral">Closed</StatusBadge> : null}
            {yourRole === 'lead' ? <StatusBadge tone="info">Lead</StatusBadge> : null}
            {yourRole === 'member' ? <StatusBadge tone="neutral">On panel</StatusBadge> : null}
            {yourRole === 'observer' ? <StatusBadge tone="neutral">View only</StatusBadge> : null}
          </div>
          <Button type="button" onClick={() => onOpen?.(entry.applicationId)}>{openLabel}</Button>
        </div>
      </div>
    </article>
  );
}

export function InterviewDayGroup({ dateKey, children }) {
  return (
    <section className="grid gap-2" aria-label={formatInterviewDay(dateKey)}>
      <h3 className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">{formatInterviewDay(dateKey)}</h3>
      {children}
    </section>
  );
}
