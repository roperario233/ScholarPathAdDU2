import { useState } from 'react';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import MonthCalendar, { CalendarLegend } from '../components/MonthCalendar';
import { getInterviewStateTone } from '../components/InterviewRoster';
import { Button, Card, EmptyState, StatusBadge } from '../components/ui';
import {
  DECISION_STAGES,
  getDeadlineMarksByDate,
  getDeadlinesForDate,
  getOfficeEntriesForDate,
  getOfficeEntryKindLabel,
  getOfficeEntryMarksByDate,
  getStageEventsForDate,
  getStageMarksByDate,
  getUpcomingOfficeEntries,
  mergeMarksByDate,
  toCalendarDateKey,
} from '../lib/calendarMarks';
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
import { getApplicationStatusLabel } from '../lib/constants';
import { fmtDate } from '../lib/formatters';

// SOP step 5 for the Department Chair. The Admissions Office coordinates the
// schedule; this page is the Chair's month view of their department: panel work
// apart from the rest of the department, the AdDU scholarship deadlines, the
// decisions recorded on the department's cases, and the office's planning dates.
// It stays read-only: the Chair edits nothing here.
const LEGEND = [
  { kind: 'your-panel', label: 'On your panel' },
  { kind: 'department-interview', label: 'Department' },
  { kind: 'deadline', label: 'Scholarship deadline' },
  { kind: 'decision', label: 'Recorded decision' },
  { kind: 'office', label: 'Office entry' },
];

const ROLE_LABELS = { lead: 'Lead', member: 'On panel', observer: 'View only' };

const AGENDA_HEADING_CLASS = 'm-0 pt-1 text-xs font-semibold uppercase tracking-wide text-app-muted';

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

// A decision the Admissions Office recorded on a department case. The Chair reads
// it as history and opens the case from it; no stage action is offered.
function AgendaDecision({ event, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(event.applicationId)}
      className="grid gap-0.5 rounded-xl border border-indigo-400/40 bg-indigo-500/10 p-3 text-left transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-app-text">{getApplicationStatusLabel(event.stage)}</strong>
        <span className="text-xs text-app-muted">{fmtDate(event.at)}</span>
      </span>
      <span className="truncate text-sm text-app-text">{event.application.studentName}</span>
      <span className="truncate text-xs text-app-muted">{event.application.scholarshipTitle}</span>
    </button>
  );
}

function AgendaOfficeEntry({ entry }) {
  return (
    <div className="grid gap-1 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3">
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="min-w-0 truncate text-sm text-app-text">{entry.title}</strong>
        <StatusBadge tone="neutral">{getOfficeEntryKindLabel(entry.kind)}</StatusBadge>
      </span>
      <span className="text-xs text-violet-700 dark:text-violet-200">{fmtDate(entry.entryDate)}</span>
      {entry.notes ? <span className="text-xs text-app-muted">{entry.notes}</span> : null}
    </div>
  );
}

export default function DepartmentCalendarView({
  profile = {},
  queue = [],
  documents = [],
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onAddComment,
  interviewWorkspace = null,
  officeCalendarEntries = [],
}) {
  const now = new Date();
  const todayKey = getManilaTodayKey(now);
  const [displayYear, setDisplayYear] = useState(Number(todayKey.slice(0, 4)) || now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // A recorded decision opens on Overview; an interview opens its Interview tab.
  const [selectedTab, setSelectedTab] = useState('interview');

  const panelists = interviewWorkspace?.panelists || [];
  const viewerId = interviewWorkspace?.viewerId || '';
  const panelIds = getPanelApplicationIds(panelists, viewerId);
  const entries = getInterviewEntries(queue);
  const upcoming = getUpcomingInterviews(queue, { now });
  const panelUpcoming = upcoming.filter((entry) => panelIds.has(entry.applicationId));
  // The department's other interviews stay visible without competing with the
  // Chair's own panel work, which the agenda lists first.
  const departmentUpcoming = upcoming.filter((entry) => !panelIds.has(entry.applicationId));
  const officeUpcoming = getUpcomingOfficeEntries(officeCalendarEntries, { todayKey });
  const marksByDate = mergeMarksByDate(
    getInterviewMarksByDate(queue, { panelApplicationIds: panelIds }),
    getDeadlineMarksByDate(scholarships, { onlyInScope: true }),
    getStageMarksByDate(queue, { stages: DECISION_STAGES }),
    getOfficeEntryMarksByDate(officeCalendarEntries),
  );

  const selectedKey = selectedDate ? toCalendarDateKey(displayYear, displayMonth, selectedDate) : '';
  const selectedEntries = selectedKey
    ? getInterviewsForDate(entries, selectedKey).filter((entry) => entry.live && entry.state === 'scheduled')
    : [];
  const selectedPanelEntries = selectedEntries.filter((entry) => panelIds.has(entry.applicationId));
  const selectedDepartmentEntries = selectedEntries.filter((entry) => !panelIds.has(entry.applicationId));
  const selectedDeadlines = selectedKey ? getDeadlinesForDate(scholarships, selectedKey, { onlyInScope: true }) : [];
  const selectedDecisions = selectedKey
    ? getStageEventsForDate(queue, selectedKey, { stages: DECISION_STAGES })
    : [];
  const selectedOfficeEntries = selectedKey ? getOfficeEntriesForDate(officeCalendarEntries, selectedKey) : [];
  const hasSelectedItems = selectedEntries.length > 0
    || selectedDeadlines.length > 0
    || selectedDecisions.length > 0
    || selectedOfficeEntries.length > 0;
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

  const goToToday = () => {
    setDisplayYear(Number(todayKey.slice(0, 4)) || now.getFullYear());
    setDisplayMonth((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
    setSelectedDate(null);
  };

  const openApplication = (applicationId, tab = 'interview') => {
    setSelectedId(applicationId);
    setSelectedTab(tab);
  };

  return (
    <div className="grid content-start gap-5 self-start">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair calendar</span>
          <h2>{profile.department || 'Department'} calendar</h2>
        </div>
        <StatusBadge tone="info">{panelUpcoming.length} on your panel</StatusBadge>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card
          title="Department schedule"
          action={<Button type="button" variant="ghost" onClick={goToToday}>Today</Button>}
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
            ariaLabel="Department Chair calendar"
          />
        </Card>

        <Card
          title={selectedDate ? 'Selected day' : 'Your next interviews'}
          action={selectedDate ? <Button type="button" variant="ghost" onClick={() => setSelectedDate(null)}>Show next</Button> : null}
        >
          <div className="grid gap-2">
            {selectedDate ? (
              hasSelectedItems ? (
                <>
                  {selectedPanelEntries.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Your panel</p>
                      {selectedPanelEntries.map((entry) => (
                        <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole={yourRoleFor(entry.applicationId)} onOpen={openApplication} />
                      ))}
                    </>
                  ) : null}
                  {selectedDepartmentEntries.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Department</p>
                      {selectedDepartmentEntries.map((entry) => (
                        <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole={yourRoleFor(entry.applicationId)} onOpen={openApplication} />
                      ))}
                    </>
                  ) : null}
                  {selectedDeadlines.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Scholarship deadlines</p>
                      {selectedDeadlines.map((scholarship) => (
                        <div key={scholarship.id} className="grid gap-0.5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
                          <strong className="truncate text-sm text-app-text">{scholarship.title}</strong>
                          <span className="text-xs text-amber-700 dark:text-amber-200">Closes {fmtDate(scholarship.deadline)}</span>
                        </div>
                      ))}
                    </>
                  ) : null}
                  {selectedDecisions.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Recorded decisions</p>
                      {selectedDecisions.map((event) => (
                        <AgendaDecision key={event.id} event={event} onOpen={(applicationId) => openApplication(applicationId, 'overview')} />
                      ))}
                    </>
                  ) : null}
                  {selectedOfficeEntries.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Office entries</p>
                      {selectedOfficeEntries.map((entry) => <AgendaOfficeEntry key={entry.id} entry={entry} />)}
                    </>
                  ) : null}
                </>
              ) : (
                <EmptyState title="Nothing on this date" />
              )
            ) : (
              <>
                {panelUpcoming.length ? (
                  panelUpcoming.slice(0, 4).map((entry) => (
                    <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole={yourRoleFor(entry.applicationId)} onOpen={openApplication} />
                  ))
                ) : (
                  <EmptyState title="No panel interviews" />
                )}
                {departmentUpcoming.length ? (
                  <>
                    <p className={AGENDA_HEADING_CLASS}>Department next</p>
                    {departmentUpcoming.slice(0, 3).map((entry) => (
                      <ChairAgendaRow key={entry.applicationId} entry={entry} yourRole="observer" onOpen={openApplication} />
                    ))}
                  </>
                ) : null}
                {officeUpcoming.length ? (
                  <>
                    <p className={AGENDA_HEADING_CLASS}>Office next</p>
                    {officeUpcoming.slice(0, 3).map((entry) => <AgendaOfficeEntry key={entry.id} entry={entry} />)}
                  </>
                ) : null}
              </>
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
          initialTab={selectedTab}
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          onClose={() => setSelectedId(null)}
          onStatusChange={onChangeApplication}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
