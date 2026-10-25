import { useState } from 'react';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import MonthCalendar, { CalendarLegend } from '../components/MonthCalendar';
import { getInterviewStateTone } from '../components/InterviewRoster';
import { Button, Card, EmptyState, StatusBadge } from '../components/ui';
import { getDeadlineMarksByDate, getDeadlinesForDate, mergeMarksByDate, toCalendarDateKey } from '../lib/calendarMarks';
import {
  formatInterviewTimeRange,
  getInterviewEntries,
  getInterviewMarksByDate,
  getInterviewsForDate,
  getManilaTodayKey,
  getPanelApplicationIds,
  getUpcomingInterviews,
} from '../lib/interviewRoster';
import { getInterviewStateLabel } from '../lib/interview';
import { fmtDate } from '../lib/formatters';

// SOP step 5 for the Department Chair. The Admissions Office coordinates the
// schedule; this page is the Chair's month view of their panel and department.
const LEGEND = [
  { kind: 'your-panel', label: 'On your panel' },
  { kind: 'department-interview', label: 'Department' },
  { kind: 'deadline', label: 'Scholarship deadline' },
];

const ROLE_LABELS = { lead: 'Lead', member: 'On panel', observer: 'View only' };

function ChairAgendaRow({ entry, yourRole, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.applicationId)}
      className="grid gap-0.5 rounded-xl border border-app-border bg-app-card p-3 text-left transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-app-text">{formatInterviewTimeRange(entry)}</strong>
        <span className="flex flex-wrap gap-1.5">
          {yourRole !== 'observer' ? <StatusBadge tone={yourRole === 'lead' ? 'info' : 'neutral'}>{ROLE_LABELS[yourRole]}</StatusBadge> : null}
          <StatusBadge tone={getInterviewStateTone(entry.state)}>{getInterviewStateLabel(entry.state)}</StatusBadge>
        </span>
      </span>
      <span className="truncate text-sm text-app-text">{entry.studentName}</span>
      <span className="truncate text-xs text-app-muted">
        {entry.scholarshipTitle} · {entry.mode === 'online' ? 'Online' : (entry.locationLabel || 'Location to be announced')}
      </span>
    </button>
  );
}

export default function DepartmentCalendarView({
  profile,
  queue = [],
  documents = [],
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onEndorseApplication,
  onAddComment,
  interviewWorkspace = null,
}) {
  const now = new Date();
  const todayKey = getManilaTodayKey(now);
  const [displayYear, setDisplayYear] = useState(Number(todayKey.slice(0, 4)) || now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const panelists = interviewWorkspace?.panelists || [];
  const viewerId = interviewWorkspace?.viewerId || '';
  const panelIds = getPanelApplicationIds(panelists, viewerId);
  const entries = getInterviewEntries(queue);
  const panelUpcoming = getUpcomingInterviews(queue, { now }).filter((entry) => panelIds.has(entry.applicationId));
  const marksByDate = mergeMarksByDate(
    getInterviewMarksByDate(queue, { panelApplicationIds: panelIds }),
    getDeadlineMarksByDate(scholarships, { onlyInScope: true }),
  );

  const selectedKey = selectedDate ? toCalendarDateKey(displayYear, displayMonth, selectedDate) : '';
  const selectedEntries = selectedKey
    ? getInterviewsForDate(entries, selectedKey).filter((entry) => entry.live && entry.state === 'scheduled')
    : [];
  const selectedDeadlines = selectedKey ? getDeadlinesForDate(scholarships, selectedKey, { onlyInScope: true }) : [];
  const selected = queue.find((entry) => entry.id === selectedId) || null;

  const yourRoleFor = (applicationId) => {
    const row = panelists.find((member) => (
      member.applicationId === applicationId && !member.removedAt && member.profileId && member.profileId === viewerId
    ));
    if (!row) return 'observer';
    return row.isLead ? 'lead' : 'member';
  };

  const shiftMonth = (delta) => {
    const next = new Date(displayYear, displayMonth + delta, 1);
    setDisplayYear(next.getFullYear());
    setDisplayMonth(next.getMonth());
    setSelectedDate(null);
  };

  return (
    <div className="grid content-start gap-5 self-start">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair calendar</span>
          <h2>{profile.department || 'Department'} interview calendar</h2>
        </div>
        <StatusBadge tone="info">{panelUpcoming.length} on your panel</StatusBadge>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card title="Department schedule">
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
            ariaLabel="Department Chair interview calendar"
          />
        </Card>

        <Card
          title={selectedDate ? 'Selected day' : 'Your next interviews'}
          action={selectedDate ? <Button type="button" variant="ghost" onClick={() => setSelectedDate(null)}>Show next</Button> : null}
        >
          <div className="grid gap-2">
            {selectedDate ? (
              selectedEntries.length || selectedDeadlines.length ? (
                <>
                  {selectedEntries.map((entry) => (
                    <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole={yourRoleFor(entry.applicationId)} onOpen={setSelectedId} />
                  ))}
                  {selectedDeadlines.map((scholarship) => (
                    <div key={scholarship.id} className="grid gap-0.5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
                      <strong className="truncate text-sm text-app-text">{scholarship.title}</strong>
                      <span className="text-xs text-amber-700 dark:text-amber-200">Closes {fmtDate(scholarship.deadline)}</span>
                    </div>
                  ))}
                </>
              ) : (
                <EmptyState title="Nothing on this date" />
              )
            ) : panelUpcoming.length ? (
              panelUpcoming.slice(0, 4).map((entry) => (
                <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole={yourRoleFor(entry.applicationId)} onOpen={setSelectedId} />
              ))
            ) : (
              <EmptyState title="No panel interviews" />
            )}
          </div>
        </Card>
      </section>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          role="department_chair"
          initialTab="interview"
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
          onEndorse={onEndorseApplication}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
