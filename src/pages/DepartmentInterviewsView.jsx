import AdminPageHeader, { AdminHeaderTile } from '../components/AdminPageHeader';
import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import ApplicationReviewModal from '../components/ApplicationReviewModal';
import MovedCaseNotice, { useMovedCase } from '../components/MovedCaseNotice';
import { InterviewDayGroup, InterviewRosterRow } from '../components/InterviewRoster';
import FilterChips from '../components/FilterChips';
import InterviewFilterBar from '../components/InterviewFilterBar';
import { Button, Card, EmptyState } from '../components/ui';
import {
  getInterviewEntries,
  getNextInterviewTile,
  getPanelApplicationIds,
  getPanelForApplication,
  getNoteCountForApplication,
  getUpcomingInterviews,
} from '../lib/interviewRoster';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { filterByAcademicYear, getAcademicYearChoices, getDefaultAcademicYear, resolveAcademicYear } from '../lib/academicYearFilter';
import {
  DEFAULT_INTERVIEW_FILTERS,
  INTERVIEW_SORTS,
  filterInterviewItems,
  getInterviewFacets,
  groupInterviewsForSort,
  hasInterviewRefinement,
  isInterviewDaySort,
} from '../lib/interviewFilters';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getReviewScopeLabel } from '../lib/reviewScope';

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
  onRejectApplication,
  onWaitlistApplication,
  onApproveApplication,
  onRecordDeliberation,
  onAddComment,
  interviewWorkspace = null,
}) {
  const now = new Date();
  const [filter, setFilter] = useState('panel');
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_INTERVIEW_FILTERS);
  // The page opens on today's academic year; the dropdown widens it to any year.
  const [academicYear, setAcademicYear] = useState(() => getDefaultAcademicYear());

  const panelists = interviewWorkspace?.panelists || [];
  const notes = interviewWorkspace?.notes || [];
  const viewerId = interviewWorkspace?.viewerId || '';
  const panelIds = getPanelApplicationIds(panelists, viewerId);
  // The categories, their counts, and the lists all read the cases of the chosen
  // academic year, so a chip never promises interviews the list hides.
  const yearChoices = useMemo(() => getAcademicYearChoices(queue), [queue]);
  const yearChoice = resolveAcademicYear(academicYear, yearChoices);
  const yearQueue = useMemo(() => filterByAcademicYear(queue, yearChoice), [queue, yearChoice]);
  const entries = getInterviewEntries(yearQueue);
  const panelEntries = entries.filter((entry) => panelIds.has(entry.applicationId));
  const panelUpcoming = getUpcomingInterviews(yearQueue, { now }).filter((entry) => panelIds.has(entry.applicationId));
  const scheduled = entries.filter((entry) => entry.live && entry.state === 'scheduled');
  const selected = queue.find((entry) => entry.id === selectedId) || null;

  const yourRoleFor = (applicationId) => {
    const row = panelists.find((member) => (
      member.applicationId === applicationId && !member.removedAt && member.profileId && member.profileId === viewerId
    ));
    if (!row) return 'observer';
    return row.isLead ? 'lead' : 'member';
  };

  const isHeld = (entry) => entry.live && entry.state === 'scheduled';
  const categories = {
    panel: panelEntries.filter(isHeld),
    department: scheduled,
    // Panel history: the panel's interviews that no longer hold a slot — a
    // cancelled schedule, or a legacy outcome recorded before attendance was
    // removed.
    history: panelEntries.filter((entry) => !isHeld(entry)),
  };
  const categoryEntries = categories[filter] || [];
  const programIndex = useMemo(
    () => buildProgramScopeIndex(interviewWorkspace?.academicPrograms || []),
    [interviewWorkspace?.academicPrograms],
  );
  // Search, sort, and the extra filters narrow whichever category is open. The
  // search also reads the panel's names.
  const settledQuery = useDebouncedValue(filters.query, 250);
  const settledFilters = { ...filters, query: settledQuery };
  const facets = getInterviewFacets(entries, programIndex);
  const visibleEntries = filterInterviewItems(categoryEntries, settledFilters, {
    programIndex,
    now,
    extraTextOf: (item) => getPanelForApplication(panelists, item.applicationId).map((member) => member.name).join(' '),
  });
  const groups = groupInterviewsForSort(visibleEntries, filters.sort);
  const isRefined = hasInterviewRefinement(settledFilters);
  const updateFilters = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const resetFilters = () => setFilters(DEFAULT_INTERVIEW_FILTERS);
  // After a stage move the case's row glows, or a notice says where it went.
  const moved = useMovedCase(visibleEntries.map((entry) => entry.applicationId));

  return (
    <div className="grid content-start gap-5 self-start">
      <AdminPageHeader
        label={`${REVIEW_ROLE_LABELS[profile.role] || 'Reviewer'} interviews`}
        title={`${getReviewScopeLabel(profile) || 'Review scope unassigned'} interview panel`}
        description="Follow the interviews in your scope and open one to record your notes for applicants on your panel."
      >
        <AdminHeaderTile
          icon={CalendarClock}
          {...getNextInterviewTile(panelUpcoming, { label: 'Next on your panel', emptyNote: 'Interviews you sit on appear here.' })}
        />
      </AdminPageHeader>

      <MovedCaseNotice notice={moved.notice} onDismiss={moved.dismiss} />

      <Card title="Interviews">
        <FilterChips
          name="reviewer-interview-filter"
          legend="Filter interviews"
          className="mb-3"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((entry) => ({
            value: entry.key,
            label: entry.label,
            count: categories[entry.key].length,
            alert: entry.key === 'panel' && categories.panel.length > 0,
          }))}
        />
        <InterviewFilterBar
          filters={filters}
          onChange={updateFilters}
          onReset={resetFilters}
          facets={facets}
          sorts={INTERVIEW_SORTS}
          shown={visibleEntries.length}
          total={categoryEntries.length}
          academicYear={yearChoice}
          academicYears={yearChoices}
          onAcademicYearChange={setAcademicYear}
        />
        <div className="grid max-h-[720px] gap-3 overflow-y-auto pr-1">
          {groups.length ? groups.map((group) => {
            const dayHeading = Boolean(group.dateKey) && isInterviewDaySort(filters.sort);
            const rows = (
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
                      showDate={!dayHeading}
                      onOpen={setSelectedId}
                    />
                  );
                })}
              </div>
            );
            return dayHeading
              ? <InterviewDayGroup key={group.dateKey} dateKey={group.dateKey}>{rows}</InterviewDayGroup>
              : <div key={group.dateKey || 'flat'}>{rows}</div>;
          }) : categoryEntries.length && isRefined ? (
            <EmptyState
              title="No interviews match"
              description="Clear the search or a filter to see the rest of this list."
              action={<div className="mt-3 flex justify-center"><Button type="button" onClick={resetFilters}>Reset search and filters</Button></div>}
            />
          ) : <EmptyState title="No interviews here" />}
        </div>
      </Card>

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          role={profile?.role || 'department_chair'}
          initialTab="interview"
          reviewComments={reviewComments}
          onAddComment={onAddComment}
          onClose={(result) => { setSelectedId(null); moved.handleClose(result); }}
          onStatusChange={(applicationId, status, options) => (
            status === 'Approved' && onApproveApplication
              ? onApproveApplication(applicationId, options?.note)
              : onChangeApplication?.(applicationId, status, options)
          )}
          onRejectApplication={onRejectApplication}
          onWaitlistApplication={onWaitlistApplication}
          onRecordDeliberation={onRecordDeliberation}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
