import { Button, StatusBadge } from './ui';
import { REQUIREMENT_STATE_LABELS, describeRequirementTypes, describeStatusActor, getProfileSnapshotSections } from '../lib/applicationRequirements';

// Re-exported so the staff surfaces (review modal, console) keep importing it
// from here while the implementation and its tests live in the lib layer.
export { describeStatusActor };
import { getDocumentTypeLabel, verificationStatuses } from '../lib/constants';
import { getVerifiableAttributeOption } from '../lib/profile';
import { getAttributeVerificationLabel, getAttributeVerificationTone, getProofStaleReason } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';

// Shared read-only pieces of an application: the required-document checklist,
// the supporting documents, and the self-reported profile snapshot. The
// application workspace, the student's submitted-application view, and the
// staff review modal all render them, so the three never describe the same
// application differently.

export function RequirementStateBadge({ state }) {
  const entry = REQUIREMENT_STATE_LABELS[state] || REQUIREMENT_STATE_LABELS.missing;
  return <StatusBadge tone={entry.tone} className="shrink-0">{entry.label}</StatusBadge>;
}

export function RequirementChecklist({ requirements, onPreview }) {
  if (!requirements.length) return <p className="m-0 text-sm text-app-muted">This program does not list required documents.</p>;
  return (
    <ul className="m-0 grid gap-2 p-0">
      {requirements.map((requirement) => (
        <li key={requirement.id} className="grid gap-1 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 flex-1 text-sm text-app-text">{requirement.label}</span>
            <RequirementStateBadge state={requirement.state} />
          </div>
          {requirement.attached.length ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-app-muted">
              {requirement.attached.map((doc) => (
                onPreview
                  ? <button key={doc.id} type="button" className="underline decoration-dotted underline-offset-2 hover:text-app-text" onClick={() => onPreview(doc)}>{doc.title} · {doc.verificationStatus}</button>
                  : <span key={doc.id}>{doc.title} · {doc.verificationStatus}</span>
              ))}
            </span>
          ) : <span className="text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)}</span>}
        </li>
      ))}
    </ul>
  );
}

// The append-only status log is the trustworthy history (RQ2): every change
// records actor_id and actor_role from the database. Staff see the reviewer's
// name when the profiles directory can resolve it; a student sees the role
// instead, because their profile read is scoped to their own row. A record with
// no log rows (an older submission, or a project whose migration is pending)
// falls back to the browser-written timeline. `describeStatusActor` is
// re-exported from src/lib/applicationRequirements.js.
export function StatusHistoryList({ statusLog = [], timeline = [], showActorName = false }) {
  if (statusLog.length) {
    return (
      <>
        <ol className="m-0 grid gap-2 pl-5">
          {statusLog.map((event) => (
            <li key={event.id} className="text-sm text-app-muted">
              <strong className="text-app-text">{event.fromStatus || 'New'} → {event.toStatus}</strong>
              {event.reason ? <span> · {event.reason}</span> : null}
              <span className="block text-xs">{describeStatusActor(event, showActorName)} · {fmtDate(event.at)}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-xs text-app-muted">Recorded automatically on every status change; the log cannot be edited.</p>
      </>
    );
  }
  if (timeline.length) {
    return (
      <ol className="m-0 grid gap-2 pl-5">
        {timeline.map((event) => (
          <li key={event.id} className="text-sm text-app-muted">
            <strong className="text-app-text">{event.stage}</strong> · {event.note}
            <span className="block text-xs">{event.actor} · {fmtDate(event.at)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return <p className="m-0 text-sm text-app-muted">No stage events recorded yet.</p>;
}

const verificationTone = (status) => (status === 'Verified' ? 'success' : status === 'Rejected' ? 'danger' : 'warning');

// Vault files attached beyond the required documents. They never gate
// submitting, but the student and the reviewers see the same list.
export function SupportingDocumentList({ documents = [], onPreview }) {
  if (!documents.length) return <p className="m-0 text-sm text-app-muted">No supporting documents attached.</p>;
  return (
    <ul className="m-0 grid gap-2 p-0">
      {documents.map((doc) => (
        <li key={doc.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
          <span className="min-w-0 flex-1 text-sm text-app-text">{doc.title} <span className="text-xs text-app-muted">· {getDocumentTypeLabel(doc.documentType)}</span></span>
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={verificationTone(doc.verificationStatus)}>{doc.verificationStatus}</StatusBadge>
            {onPreview ? <Button type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Renders a declared attribute value: the value a proof was uploaded to attest
// (any verifiable attribute) or the student's current QPI and household income
// from the staff directory.
const formatDeclaredValue = (key, value) => {
  if (value == null || value === '') return 'not provided';
  if (key === 'qpi') return Number(value).toFixed(2);
  if (key === 'householdIncome') return fmtCurrency(Number(value));
  return String(value);
};

const hasAttestedValue = (doc, key) => Boolean(doc.attestedValues) && Object.prototype.hasOwnProperty.call(doc.attestedValues, key);

// One attached Document Vault file in the staff review modal: what it proves,
// the value declared at upload against the student's current value, and, for
// the Admissions Office (when `onChangeDocument` is passed), the verification
// actions. Department Chairs get the same details read-only.
export function DocumentVerificationItem({ doc, application, owner = null, onPreview, onChangeDocument }) {
  // The declared value a staff member can compare the file against, read from
  // the profiles directory first and the application second.
  const declaredFor = (key) => {
    if (key === 'qpi') return owner?.qpi ?? application?.studentQpi ?? null;
    if (key === 'householdIncome') return owner?.householdIncome ?? application?.studentHouseholdIncome ?? null;
    return null;
  };
  const linkedAttributes = Array.isArray(doc.linkedAttributes) ? doc.linkedAttributes : [];
  return (
    <li className="grid gap-2 border-b border-app-border/60 pb-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block text-sm text-app-text">{doc.title}</span>
          <span className="block text-xs text-app-muted">{doc.fileName ? `${doc.fileName} · ` : ''}{getDocumentTypeLabel(doc.documentType)}</span>
        </div>
        <StatusBadge tone={verificationTone(doc.verificationStatus)} className="shrink-0">{doc.verificationStatus}</StatusBadge>
      </div>
      {linkedAttributes.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Proves</span>
          {linkedAttributes.map((key) => {
            const declared = declaredFor(key);
            const hasDeclared = declared != null && declared !== '';
            const attested = hasAttestedValue(doc, key);
            // The directory only carries QPI and household income, so the value
            // check runs for those; the academic-year check runs for all.
            const staleReason = getProofStaleReason(doc, key, {
              profile: hasDeclared && ['qpi', 'householdIncome'].includes(key) ? { [key]: declared } : null,
            });
            return (
              <span key={key} className="inline-flex flex-wrap items-center gap-1">
                <StatusBadge tone="info">{getVerifiableAttributeOption(key)?.label || key}</StatusBadge>
                {attested
                  ? <span className="text-xs text-app-muted">Declared at upload: {formatDeclaredValue(key, doc.attestedValues[key])}</span>
                  : hasDeclared ? <span className="text-xs text-app-muted">Declared: {formatDeclaredValue(key, declared)}</span> : null}
                {staleReason === 'value' && <span className="text-xs text-app-muted">Profile now: {formatDeclaredValue(key, declared)}</span>}
                {staleReason && <StatusBadge tone="danger">{staleReason === 'year' ? 'Outdated · earlier academic year' : 'Outdated · profile changed'}</StatusBadge>}
              </span>
            );
          })}
          {!linkedAttributes.some((key) => hasAttestedValue(doc, key) || declaredFor(key) != null) && (
            <span className="text-xs text-app-muted">Declared values are in the student’s My Profile.</span>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {onPreview ? <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button> : null}
        {onChangeDocument && verificationStatuses.filter((status) => status !== doc.verificationStatus).map((status) => (
          <Button key={status} type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, status)}>{status}</Button>
        ))}
      </div>
    </li>
  );
}

const SnapshotRow = ({ label, value, verification }) => (
  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-app-border/60 py-2 last:border-b-0">
    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</span>
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <strong className="text-sm text-app-text">{value || 'Not encoded'}</strong>
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
    </span>
  </div>
);

const SnapshotRows = ({ rows }) => rows.map((row) => <SnapshotRow key={row.label} {...row} />);

// Values are self-reported; a badge only reflects Document Vault proof reviewed
// by the Admissions Office, never a Registrar record. The answers the
// application needs stay open; the other groups fold so long snapshots stay
// scannable on a phone and in the review modal. `expanded` opens every group,
// for the workspace step where the student checks what they are about to send.
export function ProfileSnapshotList({ snapshot, expanded = false }) {
  if (!snapshot) return <p className="m-0 text-sm text-app-muted">No profile snapshot was recorded.</p>;
  const { legacy, sections } = getProfileSnapshotSections(snapshot);
  const [primary, ...groups] = sections;
  return (
    <div className="grid">
      <SnapshotRows rows={primary.rows} />
      {groups.map((section) => (
        <details key={section.key} open={expanded} className="group border-b border-app-border/60 last:border-b-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-2 text-sm font-semibold text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 [&::-webkit-details-marker]:hidden">
            <span>{section.title}</span>
            <span aria-hidden="true" className="text-app-muted transition group-open:rotate-180">▾</span>
          </summary>
          <div className="grid pb-2 pl-3">
            <SnapshotRows rows={section.rows} />
          </div>
        </details>
      ))}
      {legacy ? <p className="m-0 pt-2 text-xs text-app-muted">Submitted before eligibility answers, background, address, and family details were recorded with applications.</p> : null}
      {snapshot.capturedAt ? <p className="m-0 pt-2 text-xs text-app-muted">Self-reported values as of {fmtDate(snapshot.capturedAt)}.</p> : null}
    </div>
  );
}
