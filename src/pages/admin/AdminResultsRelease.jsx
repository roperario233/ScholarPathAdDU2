import { Award, ChevronDown, Gavel, SendHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import ApplicationReviewModal from '../../components/ApplicationReviewModal';
import { StatCard, getCaseCardClass } from '../../components/pageParts';
import { Button, Card, EmptyState, ExportButton, StatusBadge } from '../../components/ui';
import { downloadApplicantSummary, getApplicantSummaryFileName, getApprovalQueue, getFinalCheckHints, getReleaseGroups } from '../../lib/admissionsOffice';
import { getActorRoleLabel } from '../../lib/applicationRequirements';
import { REVIEW_ROLE_LABELS, buildProgramScopeIndex, getApplicationScope, getApproverRoleForApplication } from '../../lib/reviewScope';
import { getLatestPanelRecommendation } from '../../lib/interview';
import { fmtDate } from '../../lib/formatters';

// The Admissions Office Head's last step (Consultation 2, #13): the school
// approves, then the Head checks each approved case for a sibling already on a
// grant or another pending case, and releases one scholarship's results to every
// applicant at the same time. Until then the student sees "Under deliberation";
// releasing notifies the accepted applicants and sends everyone else the general
// letter with the number of applicants and the number accepted (#8).
export default function AdminResultsRelease({
  applications = [],
  documents = [],
  students = {},
  scholarships = [],
  role = 'admissions_head',
  onChangeApplication,
  onRejectApplication,
  onApproveApplication,
  onReleaseResults,
  onReleaseScholarshipResults,
  resultsReleases = [],
  academicPrograms = [],
  interviewWorkspace = null,
}) {
  const [openId, setOpenId] = useState(null);
  const [checked, setChecked] = useState({});
  const [busyScholarship, setBusyScholarship] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [expandedReleases, setExpandedReleases] = useState({});
  const programIndex = useMemo(() => buildProgramScopeIndex(academicPrograms), [academicPrograms]);
  const approvalLevels = interviewWorkspace?.approvalLevels || [];
  const awaitingSchool = useMemo(() => getApprovalQueue(applications), [applications]);
  const groups = useMemo(() => getReleaseGroups(applications, scholarships, resultsReleases), [applications, scholarships, resultsReleases]);
  const approvedCount = groups.reduce((total, group) => total + group.approved.length, 0);
  const finalList = applications.filter((entry) => ['Approved', 'Released'].includes(entry.status));
  const selected = applications.find((entry) => entry.id === openId);
  const releasedHistory = [...resultsReleases].filter((release) => release.releasedBy).reverse();
  const titleById = Object.fromEntries(scholarships.map((entry) => [entry.id, entry.title]));
  const notesFor = (applicationId) => (interviewWorkspace?.notes || []).filter((note) => note.applicationId === applicationId);

  // The review surface offers the Head's override at Recommended and the final
  // check's Reject at Approved; every other move stays with the role map.
  const handleStatusChange = (applicationId, status, options) => (
    status === 'Approved'
      ? onApproveApplication?.(applicationId, options?.note)
      : onChangeApplication?.(applicationId, status, options)
  );

  const exportOptions = (source) => ({
    scopeOf: (entry) => getApplicationScope(entry, programIndex),
    recommendationOf: (entry) => getLatestPanelRecommendation(notesFor(entry.id)),
    source: { exportedBy: getActorRoleLabel(role), ...source },
  });

  const exportFinalList = () => downloadApplicantSummary(finalList, exportOptions({
    origin: 'Final check and release › Final check by scholarship',
    contents: 'Every approved and released application, all scholarships. Approved cases are still awaiting their scholarship’s release.',
    releasedIds: resultsReleases.flatMap((release) => release.applicationIds || []),
  }), getApplicantSummaryFileName('final_check'));

  const releaseApplications = (release) => {
    const ids = new Set(release.applicationIds || []);
    return applications.filter((entry) => ids.has(entry.id));
  };

  const exportRelease = (release, covered) => {
    const title = titleById[release.scholarshipId] || 'Scholarship';
    downloadApplicantSummary(covered, exportOptions({
      origin: 'Final check and release › Released results',
      contents: `Every application covered by the results released on ${fmtDate(release.releasedAt)}: ${release.acceptedCount} of ${release.applicantCount} accepted.`,
      scholarship: title,
      releasedAt: release.releasedAt,
      releasedIds: release.applicationIds || [],
    }), getApplicantSummaryFileName(title, 'released'));
  };

  const releaseGroup = async (group) => {
    setBusyScholarship(group.scholarshipId);
    setFeedback(null);
    const result = await onReleaseScholarshipResults?.(group.scholarshipId);
    setBusyScholarship('');
    if (result?.error) {
      setFeedback({ tone: 'error', message: result.error });
      return;
    }
    const release = result?.release;
    setFeedback({
      tone: 'success',
      message: release
        ? `${group.title}: results released. ${release.acceptedCount} of ${release.applicantCount} applicant${release.applicantCount === 1 ? '' : 's'} accepted; the others receive the general letter.`
        : `${group.title}: results released.`,
    });
  };

  return (
    <div className="grid content-start gap-5">
      <AdminPageHeader
        title="Final check and release"
        description="Check each approved case, then release a scholarship's results to every applicant at once."
        badge={`${approvedCount} awaiting your final check`}
        badgeTone={approvedCount ? 'warning' : 'success'}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Gavel} tone="warning" label="Awaiting the school's approval" value={awaitingSchool.length} note="Approved by the configured level" />
        <StatCard icon={Award} tone="info" label="Approved — final check" value={approvedCount} note="Siblings on a grant, pending cases" />
        <StatCard icon={SendHorizontal} tone="success" label="Results released" value={applications.filter((entry) => entry.status === 'Released').length} note="Accepted applicants notified" />
      </section>

      {feedback ? (
        <p
          className={`m-0 rounded-[14px] border px-3 py-2 text-sm ${feedback.tone === 'error' ? 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >{feedback.message}</p>
      ) : null}

      <Card title="Final check by scholarship" action={<ExportButton disabled={!finalList.length} onClick={exportFinalList} />}>
        <div className="grid gap-4">
          {groups.length ? groups.map((group) => {
            const allChecked = group.approved.every((entry) => checked[entry.id]);
            const notAccepted = group.decided.filter((entry) => entry.status === 'Rejected').length;
            return (
              <section key={group.scholarshipId} className={getCaseCardClass('success')}>
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="m-0 min-w-0 text-base font-semibold">{group.title}</h3>
                  <span className="text-xs text-app-muted">
                    {group.approved.length} approved · {group.decided.length} decided, not yet released{notAccepted ? ` (${notAccepted} not accepted)` : ''}
                  </span>
                </div>
                {group.approved.length ? (
                  <ul className="m-0 grid gap-2 p-0">
                    {group.approved.map((entry) => {
                      const hints = getFinalCheckHints(entry, applications);
                      const flagged = hints.siblingsOnGrant.length || hints.pendingCases.length || hints.selfDeclaredSibling;
                      return (
                        <li key={entry.id} className="grid gap-2 rounded-2xl border border-app-border bg-app-card/60 p-3">
                          <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between">
                            <div className="min-w-0 w-full">
                              <strong className="block truncate text-sm">{entry.studentName}</strong>
                              <span className="text-xs text-app-muted">{entry.studentProgram || 'Program on file'} · approved {entry.updatedAt ? fmtDate(entry.updatedAt) : ''}</span>
                            </div>
                            <StatusBadge tone={flagged ? 'warning' : 'success'}>{flagged ? 'Check before release' : 'No flags'}</StatusBadge>
                          </div>
                          {flagged ? (
                            <ul className="m-0 grid gap-1 pl-4 text-xs text-amber-700 dark:text-amber-300">
                              {hints.siblingsOnGrant.map((sibling) => (
                                <li key={`sib-${sibling.id}`}>Possible sibling on a grant: {sibling.studentName} ({sibling.scholarshipTitle}, same parent name).</li>
                              ))}
                              {hints.selfDeclaredSibling ? <li>The applicant declared a sibling already on AdDU financial aid.</li> : null}
                              {hints.pendingCases.map((pending) => (
                                <li key={`pending-${pending.id}`}>Another open application: {pending.scholarshipTitle} ({pending.status}).</li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={Boolean(checked[entry.id])}
                                onChange={(event) => setChecked((previous) => ({ ...previous, [entry.id]: event.target.checked }))}
                              />
                              Final check done
                            </label>
                            <Button type="button" variant="secondary" onClick={() => setOpenId(entry.id)}>Open case</Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
                  <span className="text-xs text-app-muted">
                    {group.approved.length && !allChecked
                      ? 'Mark every approved case as checked to release.'
                      : 'Releasing notifies the accepted applicants and sends the general letter to the others.'}
                  </span>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!allChecked || busyScholarship === group.scholarshipId}
                    onClick={() => releaseGroup(group)}
                  >{busyScholarship === group.scholarshipId ? 'Releasing…' : 'Release results'}</Button>
                </div>
              </section>
            );
          }) : <EmptyState title="Nothing to release yet" description="Approved applications appear here after the school's approval." />}
        </div>
      </Card>

      <Card title="Awaiting the school's approval" action={<StatusBadge tone={awaitingSchool.length ? 'info' : 'success'}>{awaitingSchool.length} with the schools</StatusBadge>}>
        <div className="grid max-h-[520px] gap-3 overflow-y-auto pb-14 pr-1 sm:pb-1">
          {awaitingSchool.length ? awaitingSchool.map((entry) => {
            const approver = getApproverRoleForApplication(entry, approvalLevels, programIndex);
            return (
              <article key={entry.id} className={getCaseCardClass('warning')}>
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                  <div className="min-w-0 w-full"><h3 className="truncate">{entry.studentName}</h3><p className="text-sm text-app-muted">{entry.scholarshipTitle} · {entry.studentProgram || 'Program on file'}</p></div>
                  <StatusBadge tone="info">With the {REVIEW_ROLE_LABELS[approver] || 'Chairperson'}</StatusBadge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-2">
                  <span className="text-xs text-app-muted">{getLatestPanelRecommendation(notesFor(entry.id))?.label || 'Recommended'} · the school decides; you can override from the case.</span>
                  <Button type="button" variant="secondary" onClick={() => setOpenId(entry.id)}>Open case</Button>
                </div>
              </article>
            );
          }) : <EmptyState title="No recommendations with the schools" />}
        </div>
      </Card>

      {releasedHistory.length ? (
        <Card title="Released results">
          <ul className="m-0 grid gap-2 p-0">
            {releasedHistory.map((release) => {
              const title = titleById[release.scholarshipId] || 'Scholarship';
              const covered = releaseApplications(release);
              const open = Boolean(expandedReleases[release.id]);
              const acceptedList = covered.filter((entry) => entry.status !== 'Rejected').length;
              const stillOpen = Math.max(0, (release.applicantCount || 0) - covered.length);
              const panelId = `release-${release.id}`;
              return (
                <li key={release.id} className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
                  <button
                    type="button"
                    className="disclosure-action flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 bg-transparent px-3 py-2.5 text-left transition hover:bg-app-card/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setExpandedReleases((previous) => ({ ...previous, [release.id]: !previous[release.id] }))}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-app-border bg-app-card text-app-muted">
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-text">{title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-app-muted">
                      <StatusBadge tone="success">{release.acceptedCount} of {release.applicantCount} accepted</StatusBadge>
                      <span>{fmtDate(release.releasedAt)}</span>
                    </span>
                  </button>
                  {open ? (
                    <div id={panelId} className="grid gap-2 border-t border-app-border bg-app-card/40 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-xs text-app-muted">
                          {covered.length
                            ? `${acceptedList} accepted · ${covered.length - acceptedList} not accepted${stillOpen ? ` · ${stillOpen} still in progress at release` : ''}`
                            : 'The covered applications are not loaded in this session.'}
                        </p>
                        <ExportButton disabled={!covered.length} onClick={() => exportRelease(release, covered)} />
                      </div>
                      {covered.length ? (
                        <ul className="m-0 grid max-h-[320px] list-none gap-1.5 overflow-y-auto p-0 pr-1">
                          {covered.map((entry) => {
                            const accepted = entry.status !== 'Rejected';
                            return (
                              <li key={entry.id} className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-app-border bg-app-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <div className="min-w-0 [overflow-wrap:anywhere]">
                                  <strong className="block text-sm font-semibold">{entry.studentName}</strong>
                                  <span className="text-xs text-app-muted">{entry.studentProgram || 'Program on file'}</span>
                                </div>
                                <StatusBadge tone={accepted ? 'success' : 'warning'}>{accepted ? 'Accepted' : 'Not accepted'}</StatusBadge>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {selected && (
        <ApplicationReviewModal
          application={selected}
          scholarship={scholarships.find((entry) => entry.id === selected.scholarshipId)}
          documents={documents}
          students={students}
          role={role}
          onClose={() => setOpenId(null)}
          onStatusChange={handleStatusChange}
          onRejectApplication={onRejectApplication}
          onRelease={onReleaseResults}
          interviewWorkspace={interviewWorkspace}
        />
      )}
    </div>
  );
}
