import { Button, ModalShell } from './ui';
import { getDocumentTypeLabel } from '../lib/constants';
import { formatProofValue, getActorRoleLabel, getDocumentProofReview } from '../lib/applicationRequirements';
import { fmtDate } from '../lib/formatters';

const rowLabel = 'text-xs font-semibold uppercase tracking-[0.1em] text-app-muted';

// Confirms a Document Vault verification before it is written. The reviewing
// account and the date are stamped by the database
// (20261027000000_add_document_decision_actor.sql), so this dialog states them
// rather than collecting them: its job is to make a one-click verification an
// explicit, attributable decision instead of an accidental press. When the file
// proves profile answers, the dialog names the values being confirmed and warns
// when the value the file was uploaded to prove differs from the application.
export default function VerifyDocumentModal({
  doc,
  application = null,
  reviewerName = '',
  reviewerRole = 'admissions_office',
  busy = false,
  error = '',
  today = new Date().toISOString(),
  onConfirm,
  onClose,
}) {
  if (!doc) return null;
  const roleLabel = getActorRoleLabel(reviewerRole) || 'Admissions Office';
  const proofs = getDocumentProofReview(doc, application || {});
  const mismatched = proofs.filter((proof) => proof.staleReason);
  return (
    <ModalShell title="Record document verification" onClose={busy ? undefined : onClose} className="w-[min(560px,100%)]">
      <div className="grid gap-4">
        <div>
          <h3 className="m-0 text-base font-semibold text-app-text">{doc.title}</h3>
          <p className="m-0 mt-1 text-sm text-app-muted">
            {doc.fileName ? `${doc.fileName} · ` : ''}{getDocumentTypeLabel(doc.documentType)}
          </p>
          {application ? (
            <p className="m-0 mt-1 text-sm text-app-muted">{application.studentName} · {application.scholarshipTitle}</p>
          ) : null}
        </div>

        <dl className="m-0 grid gap-2 rounded-[14px] border border-app-border bg-app-surface p-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <dt className={rowLabel}>Recorded as</dt>
            <dd className="m-0 min-w-0 truncate font-semibold text-app-text">{reviewerName || roleLabel}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <dt className={rowLabel}>Office</dt>
            <dd className="m-0 font-semibold text-app-text">{roleLabel}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <dt className={rowLabel}>Date</dt>
            <dd className="m-0 font-semibold text-app-text">{fmtDate(today)}</dd>
          </div>
        </dl>

        {proofs.length ? (
          <div className="grid gap-1 rounded-[14px] border border-app-border bg-app-surface p-3 text-sm">
            <span className={rowLabel}>Confirms</span>
            {proofs.map((proof) => (
              <span key={proof.key} className="text-app-text">
                <strong>{proof.label}</strong>{' '}
                {proof.hasDeclared ? formatProofValue(proof.key, proof.declared) : proof.hasAttested ? formatProofValue(proof.key, proof.attested) : 'as declared in the profile snapshot'}
              </span>
            ))}
            <span className="text-xs text-app-muted">Verify only if the file shows these values; otherwise reject it.</span>
          </div>
        ) : null}

        {mismatched.length ? (
          <p className="m-0 rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-app-text" role="alert">
            {mismatched.map((proof) => (proof.staleReason === 'year'
              ? `This ${proof.label} proof is from an earlier academic year than the submission.`
              : `This file was uploaded to prove ${proof.label} ${formatProofValue(proof.key, proof.attested)}, but the application declares ${formatProofValue(proof.key, proof.declared)}.`)).join(' ')}
          </p>
        ) : null}

        {error ? (
          <p className="m-0 rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-3">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => onConfirm?.()}>
            {busy ? 'Recording…' : 'Record verification'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
