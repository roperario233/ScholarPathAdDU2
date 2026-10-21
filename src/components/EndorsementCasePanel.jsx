import ApplicationCommentThread from './ApplicationCommentThread';
import { Button, Panel } from './ui';
import { getDocumentVerificationReadiness } from '../lib/applicationRequirements';
import { getStageActionLabel, isAdmissionsReviewerRole } from '../lib/constants';
import {
  getApplicationComments,
  getEndorsementAgeDays,
  getEndorsementDecisionEvent,
  getEndorsementHandoff,
  isEndorsementOverdue,
} from '../lib/endorsement';
import { fmtDate } from '../lib/formatters';

const sectionHeading = 'm-0 text-sm font-bold uppercase tracking-[0.1em] text-app-muted';

// The Endorsement tab, kept small: what happened at the hand-off and decision,
// one internal comment thread, and the role-scoped action.
export default function EndorsementCasePanel({
  application,
  documents = [],
  comments = [],
  role,
  onAddComment,
  onRequestDecision,
}) {
  const readiness = getDocumentVerificationReadiness(application, documents);
  const documentsReady = readiness.total > 0 && readiness.ready;
  const handoff = getEndorsementHandoff(application);
  const decision = getEndorsementDecisionEvent(application);
  const record = application.endorsement;
  const age = getEndorsementAgeDays(application);
  const overdue = isEndorsementOverdue(application);
  const thread = getApplicationComments(comments, application.id);

  const canDecide = Boolean(
    onRequestDecision
    && ((isAdmissionsReviewerRole(role) && application.status === 'For Verification')
      || (role === 'department_chair' && application.status === 'For Endorsement')),
  );
  const decisionLabel = role === 'department_chair'
    ? getStageActionLabel('Endorsed', 'department_chair')
    : getStageActionLabel('For Endorsement', 'admissions_office');
  const blockedReason = documentsReady
    ? ''
    : readiness.total === 0
      ? 'No Document Vault file is attached to this application.'
      : `${readiness.outstanding} attached document${readiness.outstanding === 1 ? '' : 's'} still need verification.`;

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h4 className={sectionHeading}>Endorsement record</h4>
        <Panel className="grid gap-2">
          {handoff ? (
            <p className="m-0 text-sm text-app-text">
              <strong>Sent to endorsement</strong> by {handoff.actor || 'the Admissions Office'} · {fmtDate(handoff.at)}
              {handoff.note ? <span className="text-app-muted"> — {handoff.note}</span> : null}
            </p>
          ) : (
            <p className="m-0 text-sm text-app-muted">
              {application.status === 'For Verification'
                ? 'Not sent to endorsement yet.'
                : 'No hand-off is recorded for this application.'}
            </p>
          )}
          {record ? (
            <p className="m-0 text-sm text-app-text">
              <strong>Endorsed</strong> by {record.reviewedBy || 'Department Chair'} · {fmtDate(record.decidedAt || decision?.at)}
              {record.note ? <span className="text-app-muted"> — {record.note}</span> : null}
            </p>
          ) : null}
          {age != null && (application.status === 'For Endorsement' || record) ? (
            <span className={`text-xs ${overdue ? 'text-rose-700 dark:text-rose-200' : 'text-app-muted'}`}>
              {application.status === 'For Endorsement'
                ? `${age} day${age === 1 ? '' : 's'} awaiting the department decision${overdue ? ' · past the 5-day target' : ''}`
                : `Decision recorded ${age} day${age === 1 ? '' : 's'} after the hand-off`}
            </span>
          ) : null}
        </Panel>
      </section>

      <section className="grid gap-2">
        <h4 className={sectionHeading}>Internal comments</h4>
        <ApplicationCommentThread
          comments={thread}
          onAddComment={onAddComment ? (body) => onAddComment(application.id, body) : undefined}
        />
      </section>

      {canDecide ? (
        <div className="grid gap-2 border-t border-app-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-app-muted">
              {documentsReady
                ? `${readiness.verified} of ${readiness.total} attached documents verified`
                : blockedReason}
            </span>
            <Button
              type="button"
              variant="primary"
              disabled={!documentsReady}
              title={blockedReason || undefined}
              onClick={() => onRequestDecision()}
            >
              {decisionLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
