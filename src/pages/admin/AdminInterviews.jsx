import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarPlus } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { InterviewDayGroup, InterviewRosterRow } from '../../components/InterviewRoster';
import FilterChips from '../../components/FilterChips';
import { getCaseCardClass } from '../../components/pageParts';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import {
  getInterviewEntries,
  getInterviewsNeedingSchedule,
  getNextInterviewTile,
  getNoteCountForApplication,
  getPanelForApplication,
  getUpcomingInterviews,
  groupInterviewsByDate,
} from '../../lib/interviewRoster';
import { getInterviewSchedulers } from '../../lib/admissionsOffice';
import { isAdmissionsHeadRole } from '../../lib/constants';
import { findRosterConflicts, formatInterviewDateShort } from '../../lib/interview';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getReviewScopeLabel } from '../../lib/reviewScope';
import { plural } from '../../lib/formatters';

// SOP step 5 for the Admissions Office. Scheduling and rescheduling open the
// shared review surface.
const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'needs-scheduling', label: 'Needs scheduling' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All interviews' },
];

// The line under an empty list, so a reader is told when the work sits in
// another category instead of seeing a bare "nothing here".
const describeOtherCategories = (others = [], counts = {}) => (
  others.length
    ? `Elsewhere: ${others.map((entry) => `${counts[entry.key]} ${entry.label.toLowerCase()}`).join(', ')}.`
    : 'Nothing is waiting in any category.'
);

// The interviewers of the applicant's school and cluster schedule the interview
// (Consultation 2); the Head can step in. Staff read the board without acting.
function ScheduleRow({ application, schedulers = [], isHead = false, onOpen }) {
  return (
    <article className={getCaseCardClass('warning')}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate">{application.studentName}</h3>
          <p className="mt-1 text-sm text-app-muted">
            {application.scholarshipTitle} · {application.studentProgram || 'Program on file'}
          </p>
        </div>
        <StatusBadge tone="warning">Awaiting schedule</StatusBadge>
      </div>
      <div className="grid gap-1.5">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">To be scheduled by</p>
        {schedulers.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {schedulers.map((person) => (
              <li
                key={person.userId || person.fullName}
                className="min-w-0 rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-sm"
              >
                <span className="font-semibold text-app-text">{person.fullName || REVIEW_ROLE_LABELS[person.role]}</span>
                <span className="text-app-muted">
                  {' · '}{REVIEW_ROLE_LABELS[person.role]}
                  {getReviewScopeLabel(person) ? ` · ${getReviewScopeLabel(person)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-amber-700 dark:text-amber-200">
            No interviewer covers this school or cluster yet. Add one on Accounts{isHead ? '' : ' (Admissions Office Head)'}.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
        <p className="m-0 min-w-0 flex-1 text-xs text-app-muted">
          {isHead
            ? 'The Head can schedule in their place.'
            : 'Read-only for Admissions Office Staff.'}
        </p>
        <Button type="button" onClick={() => onOpen(application.id)}>
          {isHead ? 'Schedule as Head' : 'View case'}
        </Button>
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
  onRejectApplication,
  onEndorseApplication,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  interviewWorkspace = null,
  initialFilter = null,
  // Case officers: opening a case from the interview board joins the officer to it.
  caseOfficers = [],
  currentUserId = '',
  onJoinCase,
  onLeaveCase,
}) {
  const now = new Date();
  const isHead = isAdmissionsHeadRole(role);
  const staffDirectory = useMemo(() => interviewWorkspace?.staffDirectory || [], [interviewWorkspace?.staffDirectory]);
  const programIndex = useMemo(
    () => buildProgramScopeIndex(interviewWorkspace?.academicPrograms || []),
    [interviewWorkspace?.academicPrograms],
  );
  // Until the reader picks a category, open the first one that has something in
  // it, so the board never lands on an empty list while work waits elsewhere.
  const [chosenFilter, setFilter] = useState(FILTERS.some((entry) => entry.key === initialFilter) ? initialFilter : null);
  const [selectedId, setSelectedId] = useState(null);

  const entries = getInterviewEntries(applications);
  const upcoming = getUpcomingInterviews(applications, { now });
  const needsSchedule = getInterviewsNeedingSchedule(applications);
  const cancelled = entries.filter((entry) => entry.state === 'cancelled');
  const counts = {
    upcoming: upcoming.length,
    'needs-scheduling': needsSchedule.length,
    cancelled: cancelled.length,
    all: entries.length,
  };
  const filter = chosenFilter
    || ['upcoming', 'needs-scheduling', 'cancelled'].find((key) => counts[key] > 0)
    || 'upcoming';
  const otherWithItems = FILTERS.filter((entry) => entry.key !== 'all' && entry.key !== filter && counts[entry.key] > 0);
  const conflicts = findRosterConflicts(applications, interviewWorkspace?.panelists || []);
  const selected = applications.find((entry) => entry.id === selectedId) || null;
  const calendarNeedsAttention = Boolean(interviewWorkspace)
    && !interviewWorkspace.calendarChecking
    && (!interviewWorkspace.calendarConfigured || interviewWorkspace.calendarReauthRequired);

  const visibleEntries = (() => {
    if (filter === 'upcoming') return upcoming;
    if (filter === 'cancelled') return cancelled;
    if (filter === 'all') return entries;
    return [];
  })();
  const groups = groupInterviewsByDate(visibleEntries);
  const showScheduleList = filter === 'needs-scheduling';

  return (
    <div className="grid content-start gap-5 self-start">
      <AdminPageHeader
        title="Interview schedule"
        description="Interviews scheduled by each school, and any panel or room clashes."
      >
        {conflicts.length ? (
          <AdminHeaderTile
            icon={AlertTriangle}
            tone="warning"
            label="Needs attention"
            title={plural(conflicts.length, 'panel or room clash', 'panel or room clashes')}
            note="Two interviews share a panelist or a room."
          />
        ) : needsSchedule.length ? (
          <AdminHeaderTile
            icon={CalendarPlus}
            tone="warning"
            label="Needs scheduling"
            title={`${plural(needsSchedule.length, 'applicant')} to schedule`}
            note="Each waits for an interviewer of its school."
            onClick={() => setFilter('needs-scheduling')}
          />
        ) : (
          <AdminHeaderTile icon={CalendarClock} {...getNextInterviewTile(upcoming)} />
        )}
      </AdminPageHeader>

      {calendarNeedsAttention ? (
        <p className="m-0 text-sm text-amber-700 dark:text-amber-200">
          Google Calendar is not connected. Online interviews need a pasted meeting link.
        </p>
      ) : null}

      <Card title="Interviews">
        <FilterChips
          name="interview-filter"
          legend="Filter interviews"
          className="mb-3"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((entry) => ({
            value: entry.key,
            label: entry.label,
            count: counts[entry.key],
            alert: entry.key === 'needs-scheduling' && counts[entry.key] > 0,
          }))}
        />
        <div className="grid max-h-[720px] gap-3 overflow-y-auto pr-1">
          {showScheduleList ? (
            needsSchedule.length ? needsSchedule.map((entry) => (
              <ScheduleRow
                key={entry.id}
                application={entry}
                schedulers={getInterviewSchedulers(entry, staffDirectory, programIndex)}
                isHead={isHead}
                onOpen={setSelectedId}
              />
            )) : <EmptyState title="Nothing to schedule" description={describeOtherCategories(otherWithItems, counts)} />
          ) : groups.length ? groups.map((group) => (
            <InterviewDayGroup key={group.dateKey} dateKey={group.dateKey}>
              <div className="grid gap-3">
                {group.entries.map((entry) => (
                  <InterviewRosterRow
                    key={entry.applicationId}
                    entry={entry}
                    panel={getPanelForApplication(interviewWorkspace?.panelists || [], entry.applicationId)}
                    notesCount={getNoteCountForApplication(interviewWorkspace?.notes || [], entry.applicationId)}
                    onOpen={setSelectedId}
                  />
                ))}
              </div>
            </InterviewDayGroup>
          )) : (
            <EmptyState
              title={filter === 'upcoming' ? 'No upcoming interviews' : 'No interviews here'}
              description={describeOtherCategories(otherWithItems, counts)}
              action={otherWithItems.length ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {otherWithItems.map((entry) => (
                    <Button key={entry.key} type="button" onClick={() => setFilter(entry.key)}>
                      {entry.label} ({counts[entry.key]})
                    </Button>
                  ))}
                </div>
              ) : null}
            />
          )}
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
          onRejectApplication={onRejectApplication}
          onEndorse={onEndorseApplication}
          interviewWorkspace={interviewWorkspace}
          onRecordDeliberation={onRecordDeliberation}
          onRelease={onReleaseResults}
          onChangeDocument={onChangeDocument}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          caseOfficers={caseOfficers}
          currentUserId={currentUserId}
          onJoinCase={onJoinCase}
          onLeaveCase={onLeaveCase}
        />
      )}
    </div>
  );
}
