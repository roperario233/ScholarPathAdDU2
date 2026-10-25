import { useState } from 'react';
import { X } from 'lucide-react';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { InterviewDayGroup, InterviewRosterRow } from '../components/InterviewRoster';
import { Card, EmptyState, StatusBadge } from '../components/ui';
import {
  getInterviewEntries,
  getInterviewsNeedingOutcome,
  getPanelApplicationIds,
  getPanelForApplication,
  getNoteCountForApplication,
  getUpcomingInterviews,
  groupInterviewsByDate,
} from '../lib/interviewRoster';

// SOP step 5 for the Department Chair: panel work only. Scheduling belongs to the
// Admissions Office, so this page records attendance and opens the Interview tab.
const FILTERS = [
  { key: 'panel', label: 'Your panel' },
  { key: 'department', label: 'Department' },
  { key: 'outcomes', label: 'Outcomes to record' },
  { key: 'completed', label: 'Completed & no-show' },
];

export default function DepartmentInterviewsView({
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
  const [filter, setFilter] = useState('panel');
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const panelists = interviewWorkspace?.panelists || [];
  const notes = interviewWorkspace?.notes || [];
  const viewerId = interviewWorkspace?.viewerId || '';
  const panelIds = getPanelApplicationIds(panelists, viewerId);
  const entries = getInterviewEntries(queue);
  const entryById = new Map(entries.map((entry) => [entry.applicationId, entry]));
  const panelEntries = entries.filter((entry) => panelIds.has(entry.applicationId));
  const panelUpcoming = getUpcomingInterviews(queue, { now }).filter((entry) => panelIds.has(entry.applicationId));
  const outcomes = getInterviewsNeedingOutcome(queue, now)
    .filter((entry) => panelIds.has(entry.id))
    .map((entry) => entryById.get(entry.id))
    .filter(Boolean);
  const completed = panelEntries.filter((entry) => ['completed', 'no_show'].includes(entry.state));
  const scheduled = entries.filter((entry) => entry.live && entry.state === 'scheduled');
  const selected = queue.find((entry) => entry.id === selectedId) || null;

  const yourRoleFor = (applicationId) => {
    const row = panelists.find((member) => (
      member.applicationId === applicationId && !member.removedAt && member.profileId && member.profileId === viewerId
    ));
    if (!row) return 'observer';
    return row.isLead ? 'lead' : 'member';
  };

  const visibleEntries = (() => {
    if (filter === 'panel') return panelEntries.filter((entry) => entry.live && entry.state === 'scheduled');
    if (filter === 'department') return scheduled;
    if (filter === 'outcomes') return outcomes;
    if (filter === 'completed') return completed;
    return panelEntries;
  })();
  const groups = groupInterviewsByDate(visibleEntries);

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
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair interviews</span>
          <h2>{profile.department || 'Department'} interview panel</h2>
        </div>
        <StatusBadge tone={outcomes.length ? 'warning' : 'info'}>
          {outcomes.length ? `${outcomes.length} outcome${outcomes.length === 1 ? '' : 's'} due` : `${panelUpcoming.length} on your panel`}
        </StatusBadge>
      </section>

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
          {groups.length ? groups.map((group) => (
            <InterviewDayGroup key={group.dateKey} dateKey={group.dateKey}>
              <div className="grid gap-3">
                {group.entries.map((entry) => {
                  const yourRole = yourRoleFor(entry.applicationId);
                  return (
                    <InterviewRosterRow
                      key={entry.applicationId}
                      entry={entry}
                      panel={getPanelForApplication(panelists, entry.applicationId)}
                      notesCount={getNoteCountForApplication(notes, entry.applicationId)}
                      yourRole={yourRole}
                      canRecordOutcome={yourRole !== 'observer' && entry.status === 'Interview'}
                      busy={busyId === entry.applicationId}
                      openLabel={yourRole === 'observer' ? 'View interview' : 'Open interview'}
                      onOpen={setSelectedId}
                      onRecordOutcome={recordOutcome}
                    />
                  );
                })}
                </div>
              </InterviewDayGroup>
            )) : <EmptyState title="No interviews here" />}
          </div>
        </Card>

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
