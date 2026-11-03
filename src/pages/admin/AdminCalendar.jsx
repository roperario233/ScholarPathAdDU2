import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import AdminPageHeader, { AdminHeaderTile } from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import FilterChips from '../../components/FilterChips';
import InterviewLocationsModal from '../../components/InterviewLocationsModal';
import MonthCalendar, { CalendarLegend, getCalendarMarkTone } from '../../components/MonthCalendar';
import { Button, Card, EmptyState, FormField, ModalShell, StatusBadge } from '../../components/ui';
import {
  DECISION_STAGES,
  OFFICE_ENTRY_KINDS,
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
} from '../../lib/calendarMarks';
import {
  formatInterviewTimeRange,
  getInterviewEntries,
  getInterviewMarksByDate,
  getInterviewsForDate,
  getManilaTodayKey,
  getNextInterviewTile,
  getUpcomingInterviews,
} from '../../lib/interviewRoster';
import { getInterviewStateLabel } from '../../lib/interview';
import { getInterviewStateTone } from '../../components/InterviewRoster';
import { getApplicationStatusLabel } from '../../lib/constants';
import { fmtDate } from '../../lib/formatters';

// SOP step 5 plus the office's own planning: interviews, the in-scope catalog
// deadlines, the recorded stage decisions, and the Admissions Office Admin's
// planning entries on one month view. Opening an interview or a decision opens
// the shared review surface; the calendar itself never writes a stage.
const LEGEND = [
  { kind: 'interview', label: 'Interview' },
  { kind: 'deadline', label: 'Scholarship deadline' },
  { kind: 'decision', label: 'Recorded decision' },
  { kind: 'office', label: 'Office entry' },
];

// One chip per mark kind, so a busy month can be narrowed without changing what
// the page reads. `all` keeps every layer on the grid.
const MARK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'interview', label: 'Interviews' },
  { value: 'deadline', label: 'Deadlines' },
  { value: 'decision', label: 'Decisions' },
  { value: 'office', label: 'Office' },
];

const AGENDA_HEADING_CLASS = 'm-0 pt-1 text-xs font-semibold uppercase tracking-wide text-app-muted';

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

// A recorded stage decision (SOP steps 4-8) is history, not queued work: it names
// the stage the office recorded and opens the case read-only from the calendar.
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

function AgendaOfficeEntry({ entry, onDelete }) {
  return (
    <div className="grid gap-1 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3">
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="min-w-0 truncate text-sm text-app-text">{entry.title}</strong>
        <StatusBadge tone="neutral">{getOfficeEntryKindLabel(entry.kind)}</StatusBadge>
      </span>
      <span className="text-xs text-violet-700 dark:text-violet-200">{fmtDate(entry.entryDate)}</span>
      {entry.notes ? <span className="text-xs text-app-muted">{entry.notes}</span> : null}
      {onDelete ? (
        <div>
          <Button type="button" variant="ghost" onClick={() => onDelete(entry.id)}>Remove</Button>
        </div>
      ) : null}
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
  onRejectApplication,
  onEndorseApplication,
  onRecordDeliberation,
  onReleaseResults,
  onChangeDocument,
  interviewWorkspace = null,
  officeCalendarEntries = [],
  onAddOfficeEntry,
  onDeleteOfficeEntry,
  // Case officers: opening a case from the office calendar joins the officer to it.
  caseOfficers = [],
  currentUserId = '',
  onJoinCase,
  onLeaveCase,
}) {
  const now = new Date();
  const todayKey = getManilaTodayKey(now);
  const [displayYear, setDisplayYear] = useState(Number(todayKey.slice(0, 4)) || now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // A recorded decision opens the case on Overview (its stage tab may not be
  // unlocked for that stage), while an interview opens the Interview tab.
  const [selectedTab, setSelectedTab] = useState('interview');
  const [venuesOpen, setVenuesOpen] = useState(false);
  const [markFilter, setMarkFilter] = useState('all');
  const [entryError, setEntryError] = useState('');
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const openEntryDialog = () => {
    setEntryError('');
    setEntryDialogOpen(true);
  };
  const closeEntryDialog = () => {
    setEntryError('');
    setEntryDialogOpen(false);
  };

  const entries = getInterviewEntries(applications);
  const upcoming = getUpcomingInterviews(applications, { now });
  const officeUpcoming = getUpcomingOfficeEntries(officeCalendarEntries, { todayKey });
  const allMarks = mergeMarksByDate(
    getInterviewMarksByDate(applications),
    getDeadlineMarksByDate(scholarships, { onlyInScope: true }),
    getStageMarksByDate(applications, { stages: DECISION_STAGES }),
    getOfficeEntryMarksByDate(officeCalendarEntries),
  );
  // A chip narrows the grid and the day agenda together, so the two can never
  // disagree about what the month contains.
  const marksByDate = markFilter === 'all'
    ? allMarks
    : Object.fromEntries(Object.entries(allMarks)
      .map(([dateKey, marks]) => [dateKey, marks.filter((mark) => mark.kind === markFilter)])
      .filter(([, marks]) => marks.length > 0));
  const shows = (kind) => markFilter === 'all' || markFilter === kind;

  const selectedKey = selectedDate ? toCalendarDateKey(displayYear, displayMonth, selectedDate) : '';
  const selectedEntries = selectedKey && shows('interview')
    ? getInterviewsForDate(entries, selectedKey).filter((entry) => entry.live && entry.state === 'scheduled')
    : [];
  const selectedDeadlines = selectedKey && shows('deadline')
    ? getDeadlinesForDate(scholarships, selectedKey, { onlyInScope: true })
    : [];
  const selectedDecisions = selectedKey && shows('decision')
    ? getStageEventsForDate(applications, selectedKey, { stages: DECISION_STAGES })
    : [];
  const selectedOfficeEntries = selectedKey && shows('office')
    ? getOfficeEntriesForDate(officeCalendarEntries, selectedKey)
    : [];
  const hasSelectedItems = selectedEntries.length > 0
    || selectedDeadlines.length > 0
    || selectedDecisions.length > 0
    || selectedOfficeEntries.length > 0;
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

  const openApplication = (applicationId, tab = 'interview') => {
    setSelectedId(applicationId);
    setSelectedTab(tab);
  };

  // Back to the Manila month that holds today, so the office does not have to page
  // through the grid after browsing a future month.
  const goToToday = () => {
    setDisplayYear(Number(todayKey.slice(0, 4)) || now.getFullYear());
    setDisplayMonth((Number(todayKey.slice(5, 7)) || (now.getMonth() + 1)) - 1);
    setSelectedDate(null);
  };

  const handleDeleteEntry = async (entryId) => {
    const result = await onDeleteOfficeEntry(entryId);
    setEntryError(result?.ok ? '' : (result?.error || 'The entry could not be removed.'));
  };

  const handleAddEntry = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const result = await onAddOfficeEntry({
      title: formData.get('officeEntryTitle'),
      entryDate: formData.get('officeEntryDate'),
      kind: formData.get('officeEntryKind'),
      notes: formData.get('officeEntryNotes'),
    });
    if (result?.ok) {
      form.reset();
      setEntryError('');
      setEntryDialogOpen(false);
      return;
    }
    setEntryError(result?.error || 'The entry could not be saved.');
  };

  return (
    <div className="grid content-start gap-5 self-start">
      <AdminPageHeader
        title="Office calendar"
        description="Interviews, scholarship deadlines, recorded decisions, and office planning entries."
      >
        <AdminHeaderTile icon={CalendarClock} {...getNextInterviewTile(upcoming, { emptyNote: 'Interviews the schools schedule appear here.' })} />
      </AdminPageHeader>

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <FilterChips
              name="calendar-mark-filter"
              legend="Show on the calendar"
              value={markFilter}
              onChange={setMarkFilter}
              options={MARK_FILTERS.map((option) => ({ ...option, dotClass: getCalendarMarkTone(option.value) }))}
            />
            <Button type="button" variant="ghost" onClick={goToToday}>Today</Button>
          </div>
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
            ariaLabel="Admissions Office calendar"
          />
        </Card>

        <Card
          title={selectedDate ? 'Selected day' : 'Next up'}
          action={selectedDate ? <Button type="button" variant="ghost" onClick={() => setSelectedDate(null)}>Show next</Button> : null}
        >
          <div className="grid gap-2">
            {selectedDate ? (
              hasSelectedItems ? (
                <>
                  {selectedEntries.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Interviews</p>
                      {selectedEntries.map((entry) => <AgendaInterview key={entry.applicationId} entry={entry} onOpen={openApplication} />)}
                    </>
                  ) : null}
                  {selectedDeadlines.length ? (
                    <>
                      <p className={AGENDA_HEADING_CLASS}>Scholarship deadlines</p>
                      {selectedDeadlines.map((scholarship) => <AgendaDeadline key={scholarship.id} scholarship={scholarship} />)}
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
                      {selectedOfficeEntries.map((entry) => (
                        <AgendaOfficeEntry key={entry.id} entry={entry} onDelete={onDeleteOfficeEntry ? handleDeleteEntry : undefined} />
                      ))}
                    </>
                  ) : null}
                </>
              ) : (
                <EmptyState title="Nothing on this date" />
              )
            ) : (
              <>
                {nextUp.length
                  ? nextUp.map((entry) => <AgendaInterview key={entry.applicationId} entry={entry} onOpen={openApplication} />)
                  : <EmptyState title="No interviews scheduled" />}
                {officeUpcoming.length ? (
                  <>
                    <p className={AGENDA_HEADING_CLASS}>Office next</p>
                    {officeUpcoming.slice(0, 3).map((entry) => (
                      <AgendaOfficeEntry key={entry.id} entry={entry} onDelete={onDeleteOfficeEntry ? handleDeleteEntry : undefined} />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </div>
        </Card>
      </section>

      {onAddOfficeEntry ? (
        <Card
          title="Office planning entries"
          action={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusBadge tone="info">Admissions Office Admin</StatusBadge>
              <Button type="button" variant="primary" onClick={openEntryDialog}>Add office entry</Button>
            </div>
          )}
        >
          <div className="grid content-start gap-2">
            <p className={AGENDA_HEADING_CLASS}>Upcoming entries</p>
            {entryError && !entryDialogOpen ? <p className="m-0 text-sm text-rose-600 dark:text-rose-300" role="alert">{entryError}</p> : null}
            {officeUpcoming.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {officeUpcoming.map((entry) => <AgendaOfficeEntry key={entry.id} entry={entry} onDelete={handleDeleteEntry} />)}
              </div>
            ) : <EmptyState title="No office entries yet" />}
          </div>
        </Card>
      ) : null}

      {entryDialogOpen && onAddOfficeEntry ? (
        <ModalShell title="Add office entry" onClose={closeEntryDialog} className="w-[min(560px,100%)]">
          <form className="grid content-start gap-3" onSubmit={handleAddEntry}>
            <FormField label="Title">
              <input name="officeEntryTitle" placeholder="Verification window closes" autoFocus />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Date">
                <input type="date" name="officeEntryDate" min={todayKey} />
              </FormField>
              <FormField label="Type">
                <select name="officeEntryKind" defaultValue="office">
                  {OFFICE_ENTRY_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{getOfficeEntryKindLabel(kind)}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Notes" hint="Optional. Shown on the calendar and in the day agenda.">
              <textarea name="officeEntryNotes" rows="3" placeholder="What the office needs to finish by this date." />
            </FormField>
            {entryError ? <p className="m-0 text-sm text-rose-600 dark:text-rose-300" role="alert">{entryError}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={closeEntryDialog}>Cancel</Button>
              <Button variant="primary" type="submit">Add to calendar</Button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          reviewerName={reviewerName}
          initialTab={selectedTab}
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
