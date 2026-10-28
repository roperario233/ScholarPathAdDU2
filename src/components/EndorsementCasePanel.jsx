import ApplicationCommentThread from './ApplicationCommentThread';
import { Panel } from './ui';
import { getDocumentVerificationReadiness } from '../lib/applicationRequirements';
import { isAdmissionsHeadRole } from '../lib/constants';
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
// one internal comment thread, and the document-readiness state. The stage
// action itself is the review modal's single sticky action bar button, so the
// hand-off/endorsement action is never rendered twice while this tab is open.
export default function EndorsementCasePanel({
  application,
  documents = [],
  comments = [],
  role,
  onAddComment,
}) {
  const readiness = getDocumentVerificationReadiness(application, documents);
  const documentsReady = readiness.total > 0 && readiness.ready;
  const handoff = getEndorsementHandoff(application);
  const decision = getEndorsementDecisionEvent(application);
  const record = application.endorsement;
  const age = getEndorsementAgeDays(application);
  const overdue = isEndorsementOverdue(application);
  const thread = getApplicationComments(comments, application.id);

  // Whether this role has a decision to take right now. The button itself lives
  // in the action bar; this only points the reviewer at it. Endorsement is the
  // Admissions Office Head's decision; Staff only hand the case off.
  const canDecide = Boolean(
    isAdmissionsHeadRole(role) && ['For Verification', 'For Endorsement'].includes(application.status),
  );
  const decisionHint = 'Forward the application to interview from the action bar below.';
  const blockedReason = documentsReady
    ? ''
    : readiness.total === 0
      ? 'No Document Vault file is attached to this application.'
      : `${readiness.outstanding} attached document${readiness.outstanding === 1 ? '' : 's'} still need verification.`;

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h4 className={sectionHeading}>Forwarding record</h4>
        <Panel className="grid gap-2">
          {handoff ? (
            <p className="m-0 text-sm text-app-text">
              <strong>Sent to endorsement</strong> by {handoff.actor || 'the Admissions Office'} · {fmtDate(handoff.at)}
              {handoff.note ? <span className="text-app-muted"> — {handoff.note}</span> : null}
            </p>
          ) : (
            <p className="m-0 text-sm text-app-muted">
              {application.status === 'For Verification'
                ? 'Not forwarded to interview yet.'
                : 'No separate hand-off: the Admissions Office Head forwarded the verified case.'}
            </p>
          )}
          {record ? (
            <p className="m-0 text-sm text-app-text">
              <strong>Forwarded to interview</strong> by {record.reviewedBy || 'the Office of Admissions & Aid'} · {fmtDate(record.decidedAt || decision?.at)}
              {record.note ? <span className="text-app-muted"> — {record.note}</span> : null}
            </p>
          ) : null}
          {age != null && (application.status === 'For Endorsement' || record) ? (
            <span className={`text-xs ${overdue ? 'text-rose-700 dark:text-rose-200' : 'text-app-muted'}`}>
              {application.status === 'For Endorsement'
                ? `${age} day${age === 1 ? '' : 's'} awaiting the endorsement decision${overdue ? ' · past the 5-day target' : ''}`
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

      {canDecide || readiness.total > 0 ? (
        <div className="grid gap-1 border-t border-app-border pt-3">
          <span className={`text-xs ${documentsReady ? 'text-app-muted' : 'text-amber-700 dark:text-amber-200'}`}>
            {documentsReady
              ? `${readiness.verified} of ${readiness.total} attached documents verified`
              : blockedReason}
          </span>
          {canDecide ? <span className="text-xs text-app-muted">{decisionHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
