import { useState } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import InterviewLocationsModal from '../../components/InterviewLocationsModal';
import MonthCalendar, { CalendarLegend } from '../../components/MonthCalendar';
import { Button, Card, EmptyState, StatusBadge } from '../../components/ui';
import { getDeadlineMarksByDate, getDeadlinesForDate, mergeMarksByDate, toCalendarDateKey } from '../../lib/calendarMarks';
import {
  formatInterviewTimeRange,
  getInterviewEntries,
  getInterviewMarksByDate,
  getInterviewsForDate,
  getManilaTodayKey,
  getUpcomingInterviews,
} from '../../lib/interviewRoster';
import { getInterviewStateLabel } from '../../lib/interview';
import { getInterviewStateTone } from '../../components/InterviewRoster';
import { fmtDate } from '../../lib/formatters';

// SOP step 5 for the Admissions Office: interviews and catalog deadlines on one
// calendar. Opening an interview opens the shared review surface.
const LEGEND = [
  { kind: 'interview', label: 'Interview' },
  { kind: 'deadline', label: 'Scholarship deadline' },
];

function AgendaInterview({ entry, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.applicationId)}
      className="grid gap-0.5 rounded-xl border border-app-border bg-app-card p-3 text-left transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-app-text">{formatInterviewTimeRange(entry)}</strong>
        <StatusBadge tone={getInterviewStateTone(entry.state)}>{getInterviewStateLabel(entry.state)}</StatusBadge>
      </span>
      <span className="truncate text-sm text-app-text">{entry.studentName}</span>
      <span className="truncate text-xs text-app-muted">
        {entry.scholarshipTitle} · {entry.mode === 'online' ? 'Online' : (entry.locationLabel || 'Location to be announced')}
      </span>
    </button>
  );
}

function AgendaDeadline({ scholarship }) {
  return (
    <div className="grid gap-0.5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
      <strong className="truncate text-sm text-app-text">{scholarship.title}</strong>
      <span className="text-xs text-amber-700 dark:text-amber-200">Closes {fmtDate(scholarship.deadline)}</span>
    </div>
  );
}

export default function AdminCalendar({
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
}) {
  const now = new Date();
  const todayKey = getManilaTodayKey(now);
  const [displayYear, setDisplayYear] = useState(Number(todayKey.slice(0, 4)) || now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [venuesOpen, setVenuesOpen] = useState(false);

  const entries = getInterviewEntries(applications);
  const upcoming = getUpcomingInterviews(applications, { now });
  const marksByDate = mergeMarksByDate(
    getInterviewMarksByDate(applications),
    getDeadlineMarksByDate(scholarships, { onlyInScope: true }),
  );

  const selectedKey = selectedDate ? toCalendarDateKey(displayYear, displayMonth, selectedDate) : '';
  const selectedEntries = selectedKey
    ? getInterviewsForDate(entries, selectedKey).filter((entry) => entry.live && entry.state === 'scheduled')
    : [];
  const selectedDeadlines = selectedKey ? getDeadlinesForDate(scholarships, selectedKey, { onlyInScope: true }) : [];
  const nextUp = upcoming.slice(0, 4);
  const selected = applications.find((entry) => entry.id === selectedId) || null;
  const canManageVenues = Boolean(interviewWorkspace?.onSaveLocation);
  const calendarBadge = !interviewWorkspace
    ? null
    : interviewWorkspace.calendarConfigured
      ? { tone: 'success', label: 'Calendar connected' }
      : interviewWorkspace.calendarChecking
        ? { tone: 'neutral', label: 'Checking calendar' }
        : interviewWorkspace.calendarReauthRequired
          ? { tone: 'warning', label: 'Reconnect calendar' }
          : { tone: 'neutral', label: 'No calendar' };

  const shiftMonth = (delta) => {
    const next = new Date(displayYear, displayMonth + delta, 1);
    setDisplayYear(next.getFullYear());
    setDisplayMonth(next.getMonth());
    setSelectedDate(null);
  };

  return (
    <div className="grid content-start gap-5 self-start">
      <AdminPageHeader
        title="Interview calendar"
        badge={`${upcoming.length} upcoming`}
        badgeTone={upcoming.length ? 'info' : 'neutral'}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card
          title="Office schedule"
          action={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {calendarBadge ? <StatusBadge tone={calendarBadge.tone}>{calendarBadge.label}</StatusBadge> : null}
              {canManageVenues ? <Button type="button" onClick={() => setVenuesOpen(true)}>Venues</Button> : null}
            </div>
          )}
        >
          <MonthCalendar
            month={displayMonth}
            year={displayYear}
            onPrevMonth={() => shiftMonth(-1)}
            onNextMonth={() => shiftMonth(1)}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            marksByDate={marksByDate}
            showMarkDots
            legend={<CalendarLegend items={LEGEND} />}
            ariaLabel="Admissions Office interview calendar"
          />
        </Card>


        <Card
          title={selectedDate ? 'Selected day' : 'Next up'}
          action={selectedDate ? <Button type="button" variant="ghost" onClick={() => setSelectedDate(null)}>Show next</Button> : null}
        >
          <div className="grid gap-2">
            {selectedDate ? (
              selectedEntries.length || selectedDeadlines.length ? (
                <>
                  {selectedEntries.map((entry) => <AgendaInterview key={entry.applicationId} entry={entry} onOpen={setSelectedId} />)}
                  {selectedDeadlines.map((scholarship) => <AgendaDeadline key={scholarship.id} scholarship={scholarship} />)}
                </>
              ) : (
                <EmptyState title="Nothing on this date" />
              )
            ) : nextUp.length ? (
              nextUp.map((entry) => <AgendaInterview key={entry.applicationId} entry={entry} onOpen={setSelectedId} />)
            ) : (
              <EmptyState title="No interviews scheduled" />
            )}
          </div>
        </Card>
      </section>

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

      {venuesOpen && interviewWorkspace?.onSaveLocation ? (
        <InterviewLocationsModal
          locations={interviewWorkspace.locations || []}
          onSave={interviewWorkspace.onSaveLocation}
          onClose={() => setVenuesOpen(false)}
        />
      ) : null}
    </div>
  );
}
