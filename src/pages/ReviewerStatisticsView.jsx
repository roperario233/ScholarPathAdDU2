import StatisticsWorkspace from '../components/StatisticsWorkspace';
import { REVIEW_ROLE_LABELS, getReviewScopeLabel, isInterviewerRole } from '../lib/reviewScope';

// The reviewer ladder's and the interviewers' statistics route (`chair-statistics`).
// It reads only the scoped queue App.jsx already builds with getScopedQueue(), so a
// Dean counts their school, an Assistant Dean their cluster, a Chairperson their
// department, and an interviewer the one level it holds. The approving level also
// sees its own decisions, and anyone on a panel sees their own interview work.
export default function ReviewerStatisticsView({
  profile = {},
  queue = [],
  documents = [],
  interviewNotes = [],
  interviewPanelists = [],
  approvalLevels = [],
  academicPrograms = [],
}) {
  const role = profile.role || '';
  const roleLabel = REVIEW_ROLE_LABELS[role] || 'Reviewer';
  const scopeLabel = getReviewScopeLabel(profile) || 'Review scope unassigned';
  return (
    <StatisticsWorkspace
      applications={queue}
      documents={documents}
      interviewNotes={interviewNotes}
      interviewPanelists={interviewPanelists}
      approvalLevels={approvalLevels}
      academicPrograms={academicPrograms}
      profile={profile}
      role={role}
      headerLabel={`${roleLabel} statistics`}
      title={isInterviewerRole(role) ? `${scopeLabel} interview statistics` : `${scopeLabel} statistics`}
      description={isInterviewerRole(role)
        ? 'The applications in your scope, your own panel work, and how the interviews you joined ended.'
        : 'The applications in your scope: where they are, how long each stage takes, how they were decided, and the decisions you made.'}
      origin={`${roleLabel} › Statistics`}
    />
  );
}
