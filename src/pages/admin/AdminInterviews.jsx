import { useState } from 'react';
import { X } from 'lucide-react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { InterviewDayGroup, InterviewRosterRow } from '../../components/InterviewRoster';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import {
  getInterviewEntries,
  getInterviewsNeedingOutcome,
  getInterviewsNeedingSchedule,
  getNoteCountForApplication,
  getPanelForApplication,
  getUpcomingInterviews,
  groupInterviewsByDate,
} from '../../lib/interviewRoster';
import { findRosterConflicts, formatInterviewDateShort } from '../../lib/interview';

// SOP step 5 for the Admissions Office. Scheduling and rescheduling open the
// shared review surface; attendance may be recorded inline.
const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'needs-scheduling', label: 'Needs scheduling' },
  { key: 'attendance', label: 'Attendance due' },
  { key: 'completed', label: 'Completed & no-show' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All interviews' },
];

function ScheduleRow({ application, onOpen }) {
  return (
    <article className="grid gap-2 rounded-[18px] border border-app-border bg-app-surface p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate">{application.studentName}</h3>
          <p className="mt-1 text-sm text-app-muted">
            {application.scholarshipTitle} · {application.studentProgram || 'Program on file'}
          </p>
        </div>
        <StatusBadge tone="warning">Needs schedule</StatusBadge>
      </div>
      <div className="flex justify-end border-t border-app-border pt-2">
        <Button type="button" onClick={() => onOpen(application.id)}>Schedule interview</Button>
      </div>
    </article>
  );
}

export default function AdminInterviews({
  applications = [],
  documents = [],
  students = {},
  scholarships = [],
  role = 'admissions_office',
  reviewerName = '',
  reviewComments = [],
  onAddComment,
  onChangeApplication,
  onEndorseApplication,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  interviewWorkspace = null,
  initialFilter = 'upcoming',
}) {
  const now = new Date();
  const [filter, setFilter] = useState(FILTERS.some((entry) => entry.key === initialFilter) ? initialFilter : 'upcoming');
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const entries = getInterviewEntries(applications);
  const upcoming = getUpcomingInterviews(applications, { now });
  const needsSchedule = getInterviewsNeedingSchedule(applications);
  const needsOutcome = getInterviewsNeedingOutcome(applications, now);
  const completed = entries.filter((entry) => ['completed', 'no_show'].includes(entry.state));
  const cancelled = entries.filter((entry) => entry.state === 'cancelled');
  const conflicts = findRosterConflicts(applications, interviewWorkspace?.panelists || []);
  const selected = applications.find((entry) => entry.id === selectedId) || null;
  const calendarNeedsAttention = Boolean(interviewWorkspace)
    && !interviewWorkspace.calendarChecking
    && (!interviewWorkspace.calendarConfigured || interviewWorkspace.calendarReauthRequired);

  const entryById = new Map(entries.map((entry) => [entry.applicationId, entry]));
  const visibleEntries = (() => {
    if (filter === 'upcoming') return upcoming;
    if (filter === 'attendance') return needsOutcome.map((entry) => entryById.get(entry.id)).filter(Boolean);
    if (filter === 'completed') return completed;
    if (filter === 'cancelled') return cancelled;
    if (filter === 'all') return entries;
    return [];
  })();
  const groups = groupInterviewsByDate(visibleEntries);
  const showScheduleList = filter === 'needs-scheduling';
  const shownCount = showScheduleList ? needsSchedule.length : visibleEntries.length;

  const recordOutcome = async (applicationId, outcome) => {
    setBusyId(applicationId);
    setFeedback(null);
    const result = await interviewWorkspace?.onRecordOutcome?.(applicationId, outcome);
    setBusyId(null);
    if (result?.error) {
      setFeedback({ tone: 'error', message: result.error });
      return;
    }
    setFeedback({ tone: 'success', message: 'Outcome recorded.' });
  };

  return (
    <div className="grid content-start gap-5 self-start">
      <AdminPageHeader
        title="Interview schedule"
        badge={`${upcoming.length} upcoming`}
        badgeTone={upcoming.length ? 'info' : 'neutral'}
      />

      {feedback ? (
        <div
          className={`flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            feedback.tone === 'error'
              ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
          }`}
          role="status"
        >
          <span className="min-w-0">{feedback.message}</span>
          <button
            type="button"
            className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {calendarNeedsAttention ? (
        <p className="m-0 text-sm text-amber-700 dark:text-amber-200">
          Google Calendar is not connected. Online interviews need a pasted meeting link.
        </p>
      ) : null}

      <Card
        title="Interviews"
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-app-muted">{shownCount} interview{shownCount === 1 ? '' : 's'}</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filter interviews"
              className="min-h-10 min-w-[11rem]"
            >
              {FILTERS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </div>
        )}
      >
        <div className="grid max-h-[720px] gap-3 overflow-y-auto pr-1">
          {showScheduleList ? (
            needsSchedule.length ? needsSchedule.map((entry) => (
              <ScheduleRow key={entry.id} application={entry} onOpen={setSelectedId} />
            )) : <EmptyState title="Nothing to schedule" />
          ) : groups.length ? groups.map((group) => (
            <InterviewDayGroup key={group.dateKey} dateKey={group.dateKey} entries={group.entries}>
              <div className="grid gap-3">
                {group.entries.map((entry) => (
                  <InterviewRosterRow
                    key={entry.applicationId}
                    entry={entry}
                    panel={getPanelForApplication(interviewWorkspace?.panelists || [], entry.applicationId)}
                    notesCount={getNoteCountForApplication(interviewWorkspace?.notes || [], entry.applicationId)}
                    canRecordOutcome={entry.status === 'Interview'}
                    busy={busyId === entry.applicationId}
                    onOpen={setSelectedId}
                    onRecordOutcome={recordOutcome}
                  />
                ))}
              </div>
            </InterviewDayGroup>
          )) : <EmptyState title="No interviews here" />}
        </div>
      </Card>

      {conflicts.length ? (
        <Card title="Schedule clashes" action={<StatusBadge tone="warning">{conflicts.length}</StatusBadge>}>
          <div className="grid gap-2">
            {conflicts.map((conflict) => (
              <p key={`${conflict.kind}-${conflict.applicationIds.join('-')}-${conflict.startsAt}`} className="m-0 text-sm text-app-text">
                {conflict.kind === 'location' ? 'Room' : 'Panelist'} · {conflict.name} · {conflict.studentNames.join(' and ')} · {formatInterviewDateShort(conflict.startsAt)}
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          reviewerName={reviewerName}
          initialTab="interview"
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          interviewWorkspace={interviewWorkspace}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
          onChangeDocument={onChangeDocument}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
        />
      )}
    </div>
  );
}
