import { useState } from 'react';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import { InterviewDayGroup, InterviewRosterRow } from '../components/InterviewRoster';
import { Card, EmptyState, StatusBadge } from '../components/ui';
import {
  getInterviewEntries,
  getPanelApplicationIds,
  getPanelForApplication,
  getNoteCountForApplication,
  getUpcomingInterviews,
  groupInterviewsByDate,
} from '../lib/interviewRoster';

// SOP step 5 for the Department Chair: panel work only. Scheduling belongs to the
// Admissions Office, so this page opens the Interview tab and never writes a
// stage.
const FILTERS = [
  { key: 'panel', label: 'Your panel' },
  { key: 'department', label: 'Department' },
  { key: 'history', label: 'Panel history' },
];

export default function DepartmentInterviewsView({
  profile,
  queue = [],
  documents = [],
  scholarships = [],
  reviewComments = [],
  onChangeApplication,
  onAddComment,
  interviewWorkspace = null,
}) {
  const now = new Date();
  const [filter, setFilter] = useState('panel');
  const [selectedId, setSelectedId] = useState(null);

  const panelists = interviewWorkspace?.panelists || [];
  const notes = interviewWorkspace?.notes || [];
  const viewerId = interviewWorkspace?.viewerId || '';
  const panelIds = getPanelApplicationIds(panelists, viewerId);
  const entries = getInterviewEntries(queue);
  const panelEntries = entries.filter((entry) => panelIds.has(entry.applicationId));
  const panelUpcoming = getUpcomingInterviews(queue, { now }).filter((entry) => panelIds.has(entry.applicationId));
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
    // Panel history: the panel's interviews that no longer hold a slot — a
    // cancelled schedule, or a legacy outcome recorded before attendance was
    // removed.
    return panelEntries.filter((entry) => !(entry.live && entry.state === 'scheduled'));
  })();
  const groups = groupInterviewsByDate(visibleEntries);

  return (
    <div className="grid content-start gap-5 self-start">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">Department Chair interviews</span>
          <h2>{profile.department || 'Department'} interview panel</h2>
        </div>
        <StatusBadge tone="info">{panelUpcoming.length} on your panel</StatusBadge>
      </section>

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
                      openLabel={yourRole === 'observer' ? 'View interview' : 'Open interview'}
                      onOpen={setSelectedId}
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
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
