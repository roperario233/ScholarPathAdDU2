import { useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarPlus } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { InterviewDayGroup, InterviewRosterRow } from '../../components/InterviewRoster';
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
import { findRosterConflicts, formatInterviewDateShort } from '../../lib/interview';
import { plural } from '../../lib/formatters';

// SOP step 5 for the Admissions Office. Scheduling and rescheduling open the
// shared review surface.
const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'needs-scheduling', label: 'Needs scheduling' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All interviews' },
];

function ScheduleRow({ application, onOpen }) {
  return (
    <article className={getCaseCardClass('warning')}>
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
  onRejectApplication,
  onEndorseApplication,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  interviewWorkspace = null,
  initialFilter = 'upcoming',
  // Case officers: opening a case from the interview board joins the officer to it.
  caseOfficers = [],
  currentUserId = '',
  onJoinCase,
  onLeaveCase,
}) {
  const now = new Date();
  const [filter, setFilter] = useState(FILTERS.some((entry) => entry.key === initialFilter) ? initialFilter : 'upcoming');
  const [selectedId, setSelectedId] = useState(null);

  const entries = getInterviewEntries(applications);
  const upcoming = getUpcomingInterviews(applications, { now });
  const needsSchedule = getInterviewsNeedingSchedule(applications);
  const cancelled = entries.filter((entry) => entry.state === 'cancelled');
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
            note="Open one to set a date and venue."
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

      <Card
        title="Interviews"
        action={(
          <div className="w-[13rem] max-w-full">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filter interviews"
              className="min-h-10 w-full"
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
