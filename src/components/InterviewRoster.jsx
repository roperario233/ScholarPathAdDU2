import { Button, StatusBadge } from './ui';
import {
  getInterviewStateLabel,
  isInterviewOutcomeDue,
} from '../lib/interview';
import { formatInterviewTimeRange } from '../lib/interviewRoster';

// One roster row, shared by the Admissions Office and Department Chair interview
// pages. Presentation only: every write goes back through the page, which routes
// it to the shared ApplicationReviewModal or the guarded recordInterviewOutcome.
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
  canRecordOutcome = false,
  onOpen,
  onRecordOutcome,
  busy = false,
  openLabel = 'Open interview',
}) {
  const outcomeDue = entry.live && isInterviewOutcomeDue(entry.interview);
  const where = entry.mode === 'online'
    ? (entry.meetingUrl
      ? <a href={entry.meetingUrl} target="_blank" rel="noreferrer" className="underline">Online · Join meeting</a>
      : 'Online · link to follow')
    : (entry.locationLabel || 'Location to be announced');

  return (
    <article className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate">{entry.studentName}</h3>
          <p className="mt-1 text-sm text-app-muted">
            {entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}
          </p>
          <p className="mt-1 text-xs text-app-muted">
            {formatInterviewTimeRange(entry)} · {where}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
          <StatusBadge tone={getInterviewStateTone(entry.state)}>{getInterviewStateLabel(entry.state)}</StatusBadge>
          {outcomeDue && canRecordOutcome ? <StatusBadge tone="warning">Attendance due</StatusBadge> : null}
          {entry.revision > 1 ? <StatusBadge tone="warning">Rescheduled</StatusBadge> : null}
          {entry.status === 'Interview' && entry.state === 'scheduled' && !panel.length ? <StatusBadge tone="warning">No panel</StatusBadge> : null}
          {!entry.live && entry.state === 'scheduled' ? <StatusBadge tone="neutral">Closed</StatusBadge> : null}
          {yourRole === 'lead' ? <StatusBadge tone="info">Lead</StatusBadge> : null}
          {yourRole === 'member' ? <StatusBadge tone="neutral">On panel</StatusBadge> : null}
          {yourRole === 'observer' ? <StatusBadge tone="neutral">View only</StatusBadge> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
        <span className="min-w-0 truncate text-xs text-app-muted">
          {describePanel(panel)}
          {notesCount ? ` · ${notesCount} note${notesCount === 1 ? '' : 's'}` : ''}
        </span>
        <div className="flex flex-wrap gap-2">
          {canRecordOutcome && outcomeDue ? (
            <>
              <Button type="button" variant="primary" disabled={busy} onClick={() => onRecordOutcome?.(entry.applicationId, 'completed')}>Mark attended</Button>
              <Button type="button" disabled={busy} onClick={() => onRecordOutcome?.(entry.applicationId, 'no_show')}>Mark did not attend</Button>
            </>
          ) : null}
          <Button type="button" onClick={() => onOpen?.(entry.applicationId)}>{openLabel}</Button>
        </div>
      </div>
    </article>
  );
}

export function InterviewDayGroup({ dateKey, entries = [], children }) {
  return (
    <section className="grid gap-3" aria-label={formatInterviewDay(dateKey)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-app-text">{formatInterviewDay(dateKey)}</h3>
        <span className="text-xs text-app-muted">{entries.length} interview{entries.length === 1 ? '' : 's'}</span>
      </div>
      {children}
    </section>
  );
}
