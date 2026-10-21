import { Fragment, useState } from 'react';
import { Camera, Clock } from 'lucide-react';
import { Button, StatusBadge } from './ui';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import { PHOTO_ACCEPT } from '../lib/photoGuide';
import { REQUIREMENT_STATE_LABELS, describeDocumentDecision, describeRequirementTypes, describeStatusActor, getProfileSnapshotSections } from '../lib/applicationRequirements';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';

// Re-exported so the staff surfaces (review modal, console) keep importing it
// from here while the implementation and its tests live in the lib layer.
export { describeStatusActor };
import { DOCUMENT_REPLACEMENT_STATUSES, getApplicationStatusLabel, getDocumentTypeLabel, isPhotoDocumentType, sopStageIndex, sopStages } from '../lib/constants';
import { getVerifiableAttributeOption } from '../lib/profile';
import { getAttributeVerificationLabel, getAttributeVerificationTone, getProofStaleReason } from '../lib/verification';
import { fmtCurrency, fmtDate } from '../lib/formatters';

// Shared read-only pieces of an application: the required-document checklist,
// the supporting documents, and the self-reported profile snapshot. The
// application workspace, the student's submitted-application view, and the
// staff review modal all render them, so the three never describe the same
// application differently.

// Standard Procedure stage track, shown on each Admissions Office queue entry and
// in the staff review modal header.
export function SopStageTrack({ status }) {
  const currentIndex = sopStageIndex(status);
  if (currentIndex == null) {
    return <StatusBadge tone="neutral">Draft — not yet in the SOP pipeline</StatusBadge>;
  }
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Standard Procedure stage track">
      {sopStages.map((stage, index) => (
        <li
          key={stage}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${index < currentIndex ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : index === currentIndex ? 'border-ateneo-strong/50 bg-ateneo/15 text-ateneo-strong dark:border-blue-400/50 dark:bg-blue-500/15 dark:text-sky-200' : 'border-app-border bg-app-surface text-app-muted'}`}
        >{getApplicationStatusLabel(stage)}</li>
      ))}
    </ol>
  );
}

export function RequirementStateBadge({ state }) {
  const entry = REQUIREMENT_STATE_LABELS[state] || REQUIREMENT_STATE_LABELS.missing;
  return <StatusBadge tone={entry.tone} className="shrink-0">{entry.label}</StatusBadge>;
}

// `renderAttachmentNote(doc)` lets the student's view add the rejection reason
// and the replace action under an attached file.
export function RequirementChecklist({ requirements, onPreview, renderAttachmentNote }) {
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
          {renderAttachmentNote ? requirement.attached.map((doc) => <Fragment key={doc.id}>{renderAttachmentNote(doc)}</Fragment>) : null}
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
              <strong className="text-app-text">{event.fromStatus ? getApplicationStatusLabel(event.fromStatus) : 'New'} → {getApplicationStatusLabel(event.toStatus)}</strong>
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
            <strong className="text-app-text">{getApplicationStatusLabel(event.stage)}</strong> · {event.note}
            <span className="block text-xs">{event.actor} · {fmtDate(event.at)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return <p className="m-0 text-sm text-app-muted">No stage events recorded yet.</p>;
}

const verificationTone = (status) => (status === 'Verified' ? 'success' : status === 'Rejected' ? 'danger' : 'warning');

// The reason the Admissions Office recorded when it rejected a vault file,
// shown to the student and to staff. Files rejected before reasons were
// recorded show nothing.
export function DocumentRejectionReason({ doc, className = '' }) {
  if (doc?.verificationStatus !== 'Rejected' || !doc.rejectionReason) return null;
  return (
    <p className={`m-0 rounded-xl border border-rose-400/30 bg-rose-500/5 px-3 py-2 text-sm text-app-text ${className}`}>
      <span className="font-semibold text-rose-600 dark:text-rose-300">Rejection reason: </span>
      <span className="whitespace-pre-line">{doc.rejectionReason}</span>
    </p>
  );
}

// Who decided a Document Vault file, from which Admissions Office lane, and
// when. The record is stamped by the database when the decision is written, so
// it is shown read-only everywhere: the reviewer pane, the Department Chair's
// pane, the student's Document Vault card, and the student's application
// details. `showReviewer` is false on student surfaces, which see the role only.
export function DocumentDecisionRecord({ doc, showReviewer = true, className = '' }) {
  if (!doc) return null;
  const pending = !doc.verificationStatus || doc.verificationStatus === 'Pending';
  // A student surface already shows the status badge, so the line only earns its
  // space once there is a decision to attribute. The reviewer pane states that a
  // file still has no decision.
  if (pending && !showReviewer) return null;
  return (
    <p className={`m-0 flex min-w-0 flex-wrap items-center gap-1.5 text-xs ${pending ? 'text-app-muted' : 'text-app-text'} ${className}`}>
      <Clock size={13} aria-hidden="true" className="shrink-0 text-app-muted" />
      <span>{describeDocumentDecision(doc, { showName: showReviewer })}</span>
    </p>
  );
}

// Lets a student swap a rejected file on a submitted, pre-endorsement
// application: pick another vault file or upload a new one (it lands in the
// Document Vault first). `options` comes from getReplacementOptions() in
// src/lib/applicationRequirements.js; `onReplace(docId, { documentId } | { file,
// documentType })` resolves to `{ ok }` or `{ error }`.
export function RejectedDocumentReplacer({ doc, options, onReplace }) {
  const { documentTypes, candidates } = options;
  const [uploadType, setUploadType] = useState(documentTypes[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const photoType = isPhotoDocumentType(uploadType)
    ? uploadType
    : documentTypes.length === 1 && isPhotoDocumentType(documentTypes[0]) ? documentTypes[0] : '';

  const run = async (payload) => {
    setBusy(true);
    setError('');
    const result = await onReplace(doc.id, payload);
    setBusy(false);
    if (result?.error) setError(result.error);
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > DOCUMENT_MAX_BYTES) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    run({ file, documentType: uploadType });
  };

  // A replacement photo is normalized by the capture modal, then uploaded into
  // the vault first (the same path as a file-picker replacement).
  const useCameraPhoto = (file) => {
    run({ file, documentType: photoType });
    return { ok: true };
  };

  return (
    <div className="grid gap-3 rounded-xl border border-rose-400/30 bg-rose-500/5 p-3">
      <div className="grid gap-1">
        <p className="m-0 text-sm font-semibold text-app-text">Replace “{doc.title}”</p>
        {doc.rejectionReason ? (
          <p className="m-0 text-sm text-app-text">
            <span className="font-semibold text-rose-600 dark:text-rose-300">Rejection reason: </span>
            <span className="whitespace-pre-line">{doc.rejectionReason}</span>
          </p>
        ) : null}
        <p className="m-0 text-xs text-app-muted">Your application keeps its current status. The new file goes to the Admissions Office for verification.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>Choose from your Document Vault</span>
          <select
            value=""
            disabled={busy || !candidates.length}
            onChange={(event) => { if (event.target.value) run({ documentId: event.target.value }); }}
            aria-label={`Choose a replacement for ${doc.title}`}
          >
            <option value="">{candidates.length ? 'Select a file…' : 'No other matching files in your vault'}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.verificationStatus} · {fmtDate(candidate.uploadedAt)}</option>
            ))}
          </select>
        </label>
        <div className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>Or upload a corrected file</span>
          <div className="flex min-w-0 flex-wrap gap-2">
            {documentTypes.length > 1 ? (
              <select className="min-w-0 flex-1" value={uploadType} onChange={(event) => setUploadType(event.target.value)} aria-label={`Document type for the replacement of ${doc.title}`} disabled={busy}>
                {documentTypes.map((type) => <option key={type} value={type}>{getDocumentTypeLabel(type)}</option>)}
              </select>
            ) : null}
            {photoType ? (
              <>
                <Button type="button" onClick={() => setCameraOpen(true)} disabled={busy}>
                  <Camera size={16} aria-hidden="true" /> Take photo
                </Button>
                <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-blue-500/35 bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                  {busy ? 'Working...' : 'Upload photo'}
                  <input type="file" accept={PHOTO_ACCEPT} className="sr-only" onChange={handleFile} disabled={busy} />
                </label>
              </>
            ) : (
              <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-blue-500/35 bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                {busy ? 'Working...' : 'Upload file'}
                <input type="file" accept={DOCUMENT_ACCEPT} className="sr-only" onChange={handleFile} disabled={busy} />
              </label>
            )}
          </div>
        </div>
      </div>
      {photoType ? <PhotoGuide documentType={photoType} defaultOpen /> : null}
      {error ? <p className="form-error m-0" role="alert">{error}</p> : null}
      {cameraOpen ? (
        <PhotoCaptureModal
          title={photoType === 'Photos of Residence' ? 'Take a replacement photo of your residence' : 'Take your 2x2 ID photo'}
          documentType={photoType}
          onUsePhoto={useCameraPhoto}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}

// Vault files attached beyond the required documents. They never gate
// submitting, but the student and the reviewers see the same list.
export function SupportingDocumentList({ documents = [], onPreview, renderAttachmentNote }) {
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
          {renderAttachmentNote ? <div className="w-full">{renderAttachmentNote(doc)}</div> : null}
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

const hasAttestedValue =(doc, key) => Boolean(doc.attestedValues) && Object.prototype.hasOwnProperty.call(doc.attestedValues, key);

// One attached Document Vault file in the staff review modal: what it proves,
// the value declared at upload against the student's current value, and, for
// the Admissions Office (when `onChangeDocument` is passed), the verification
// actions. Department Chairs get the same details read-only. `as` lets the
// review modal's preview pane render it outside a list.
export function DocumentVerificationItem({ doc, application, owner = null, onPreview, onChangeDocument, as: Element = 'li' }) {
  // The declared value a staff member can compare the file against, read from
  // the profiles directory first and the application second.
  const declaredFor = (key) => {
    if (key === 'qpi') return owner?.qpi ?? application?.studentQpi ?? null;
    if (key === 'householdIncome') return owner?.householdIncome ?? application?.studentHouseholdIncome ?? null;
    return null;
  };
  const linkedAttributes = Array.isArray(doc.linkedAttributes) ? doc.linkedAttributes : [];
  // A decision can be corrected (reset to Pending) only while the application is
  // still before endorsement; protect_verified_documents_on_progress refuses it
  // once the file has carried the application past verification.
  const canReset = DOCUMENT_REPLACEMENT_STATUSES.includes(application?.status);
  return (
    <Element className="grid gap-2 border-b border-app-border/60 pb-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block text-sm text-app-text">{doc.title}</span>
          <span className="block text-xs text-app-muted">{doc.fileName ? `${doc.fileName} · ` : ''}{getDocumentTypeLabel(doc.documentType)}</span>
        </div>
        <StatusBadge tone={verificationTone(doc.verificationStatus)} className="shrink-0">{doc.verificationStatus}</StatusBadge>
      </div>
      <DocumentRejectionReason doc={doc} />
      <DocumentDecisionRecord doc={doc} />
      {isPhotoDocumentType(doc.documentType) ? (
        <p className="m-0 rounded-xl border border-sky-400/30 bg-sky-500/5 px-3 py-2 text-xs text-app-muted">
          {doc.documentType === 'Photos of Residence'
            ? 'Check that the photos show the residence clearly, inside and out, with no people in the frame and no signs of editing.'
            : "Check that the photo is recent, sharp, and unobstructed, with a plain background and the applicant's whole face visible."}
        </p>
      ) : null}
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
        {onChangeDocument ? (
          <>
            {doc.verificationStatus !== 'Verified' ? (
              <Button variant="primary" type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, 'Verified')}>Verify document</Button>
            ) : null}
            {doc.verificationStatus !== 'Rejected' ? (
              <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, 'Rejected')}>Reject</Button>
            ) : null}
            {doc.verificationStatus !== 'Pending' && canReset ? (
              <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, 'Pending')}>Reset to pending</Button>
            ) : null}
          </>
        ) : null}
      </div>
    </Element>
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
