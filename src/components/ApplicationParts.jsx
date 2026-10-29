import { Fragment, useEffect, useState } from 'react';
import { Camera, Clock } from 'lucide-react';
import { Button, StatusBadge } from './ui';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import { PHOTO_ACCEPT } from '../lib/photoGuide';
import { REQUIREMENT_STATE_LABELS, describeDocumentDecision, describeRequirementTypes, describeStatusActor, formatProofValue, getDocumentProofReview, getProfileSnapshotSections } from '../lib/applicationRequirements';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, isImageFileName } from '../lib/documentStorage';
import { getSupabaseDocumentUrl } from '../lib/supabaseData';

// Re-exported so the staff surfaces (review modal, console) keep importing it
// from here while the implementation and its tests live in the lib layer.
export { describeStatusActor };
import { APPLICATION_REJECTION_NOTICE, DOCUMENT_REPLACEMENT_STATUSES, getApplicationStatusLabel, getDocumentStatusLabel, getDocumentTypeLabel, isPhotoDocumentType, sopStageIndex, sopStages } from '../lib/constants';
import { describeAttributeVerification, getAttributeVerificationLabel, getAttributeVerificationTone } from '../lib/verification';
import { fmtDate } from '../lib/formatters';

// Shared read-only pieces of an application: the required-document checklist,
// the supporting documents, and the self-reported profile snapshot. The
// application workspace, the student's submitted-application view, and the
// staff review modal all render them, so the three never describe the same
// application differently.

// Standard Procedure stage track, shown on each Admissions Office queue entry and
// in the staff review modal header. Nine labelled pills wrapped into three lines
// on a phone and crowded the review header, so below the `sm` breakpoint the track
// becomes a segmented progress bar under a caption naming the position; the status
// badge beside the applicant already names the current stage. The stage names stay
// in the markup for assistive tech, so the list reads the same at every width.
export function SopStageTrack({ status }) {
  const currentIndex = sopStageIndex(status);
  if (currentIndex == null) {
    return <StatusBadge tone="neutral">Draft — not yet in the SOP pipeline</StatusBadge>;
  }
  return (
    <div className="grid gap-1">
      {/* The status badge beside the applicant already names the current stage, so
          the caption only carries the position. */}
      <span className="text-[11px] font-semibold text-app-muted sm:hidden">
        Standard Procedure stage {currentIndex + 1} of {sopStages.length}
      </span>
      <ol className="flex min-w-0 gap-1 sm:flex-wrap" aria-label="Standard Procedure stage track">
        {sopStages.map((stage, index) => {
          const isDone = index < currentIndex;
          const isCurrent = index === currentIndex;
          // The phone bar is filled, so it uses a solid tone; the labelled pill
          // colours are scoped to `sm` so the two treatments never fight over the
          // same utility.
          const fill = isDone ? 'bg-emerald-400/50' : isCurrent ? 'bg-sky-400/75' : 'bg-app-border';
          const pill = isDone
            ? 'sm:border-emerald-600/35 sm:bg-emerald-500/15 sm:text-emerald-800 sm:dark:border-emerald-400/30 sm:dark:bg-emerald-400/10 sm:dark:text-emerald-300'
            : isCurrent
              ? 'sm:border-ateneo-strong/50 sm:bg-ateneo/15 sm:text-ateneo-strong sm:dark:border-blue-400/50 sm:dark:bg-blue-500/15 sm:dark:text-sky-200'
              : 'sm:border-app-border sm:bg-app-surface sm:text-app-muted';
          return (
            <li
              key={stage}
              aria-current={isCurrent ? 'step' : undefined}
              className={`h-1.5 min-w-0 flex-1 rounded-full border border-transparent ${fill} ${pill} sm:h-auto sm:flex-none sm:px-2 sm:py-0.5 sm:text-[10px] sm:font-semibold`}
            >
              <span className="sr-only sm:not-sr-only">{getApplicationStatusLabel(stage)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RequirementStateBadge({ state }) {
  const entry = REQUIREMENT_STATE_LABELS[state] || REQUIREMENT_STATE_LABELS.missing;
  return <StatusBadge tone={entry.tone} className="shrink-0">{entry.label}</StatusBadge>;
}

// `renderAttachmentNote(doc)` lets the student's view add the resubmission note
// and the replace action under an attached file.
export function RequirementChecklist({ requirements, onPreview, renderAttachmentNote }) {
  if (!requirements.length) return <p className="m-0 text-sm text-app-muted">This program does not list required documents.</p>;
  return (
    <ul className="m-0 grid gap-2 p-0">
      {requirements.map((requirement) => (
        <li key={requirement.id} className="grid gap-1 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
          <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <span className="min-w-0 text-sm text-app-text">{requirement.label}</span>
            <RequirementStateBadge state={requirement.state} />
          </div>
          {requirement.attached.length ? (
            <span className="flex min-w-0 flex-col items-start gap-y-1 text-xs text-app-muted sm:flex-row sm:flex-wrap sm:gap-x-3">
              {requirement.attached.map((doc) => (
                onPreview
                  ? <button key={doc.id} type="button" className="underline decoration-dotted underline-offset-2 hover:text-app-text" onClick={() => onPreview(doc)}>{doc.title} · {getDocumentStatusLabel(doc.verificationStatus)}</button>
                  : <span key={doc.id}>{doc.title} · {getDocumentStatusLabel(doc.verificationStatus)}</span>
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
  // A student surface never repeats an application rejection reason: it lives in
  // the staff-only internal notes (App.jsx rejectApplication), and rows recorded
  // before that rule still hold one, so the fixed notice is rendered in its
  // place. Document resubmission reasons are not affected — they tell the student
  // what to correct.
  const studentSurface = !showActorName;
  const rejectionNote = (status, note) => (
    studentSurface && status === 'Rejected' ? APPLICATION_REJECTION_NOTICE : note
  );
  if (statusLog.length) {
    return (
      <>
        <ol className="m-0 grid gap-2 pl-5">
          {statusLog.map((event) => (
            <li key={event.id} className="text-sm text-app-muted">
              <strong className="text-app-text">{event.fromStatus ? getApplicationStatusLabel(event.fromStatus) : 'New'} → {getApplicationStatusLabel(event.toStatus)}</strong>
              {event.reason ? <span> · {rejectionNote(event.toStatus, event.reason)}</span> : null}
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
            <strong className="text-app-text">{getApplicationStatusLabel(event.stage)}</strong> · {rejectionNote(event.stage, event.note)}
            <span className="block text-xs">{event.actor} · {fmtDate(event.at)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return <p className="m-0 text-sm text-app-muted">No stage events recorded yet.</p>;
}

const verificationTone = (status) => (status === 'Verified' ? 'success' : status === 'Rejected' ? 'danger' : 'warning');

// The reason the Admissions Office recorded when it reverted a vault file for
// resubmission, shown to the student and to staff. The decision is stored as
// `Rejected`; only the label says what the student has to do. Files reverted
// before reasons were recorded show nothing.
export function DocumentRejectionReason({ doc, className = '' }) {
  if (doc?.verificationStatus !== 'Rejected' || !doc.rejectionReason) return null;
  return (
    <p className={`m-0 rounded-xl border border-rose-400/30 bg-rose-500/5 px-3 py-2 text-sm text-app-text ${className}`}>
      <span className="font-semibold text-rose-600 dark:text-rose-300">What to correct: </span>
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

// Lets a student swap a file that was reverted for resubmission on a submitted,
// pre-endorsement application: pick another vault file or upload a new one (it
// lands in the Document Vault first). `options` comes from
// getReplacementOptions() in src/lib/applicationRequirements.js;
// `onReplace(docId, { documentId } | { file, documentType })` resolves to
// `{ ok }` or `{ error }`.
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
            <span className="font-semibold text-rose-600 dark:text-rose-300">What to correct: </span>
            <span className="whitespace-pre-line">{doc.rejectionReason}</span>
          </p>
        ) : null}
        <p className="m-0 text-xs text-app-muted">Your application keeps its current status. The new file goes to verification.</p>
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
              <option key={candidate.id} value={candidate.id}>{candidate.title} · {getDocumentStatusLabel(candidate.verificationStatus)} · {fmtDate(candidate.uploadedAt)}</option>
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
        <li key={doc.id} className="grid min-w-0 gap-2 border-b border-app-border/60 pb-2 last:border-b-0 last:pb-0">
          <span className="min-w-0 text-sm text-app-text">{doc.title} <span className="text-xs text-app-muted">· {getDocumentTypeLabel(doc.documentType)}</span></span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge tone={verificationTone(doc.verificationStatus)}>{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
            {onPreview ? <Button type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button> : null}
          </span>
          {renderAttachmentNote ? <div className="w-full">{renderAttachmentNote(doc)}</div> : null}
        </li>
      ))}
    </ul>
  );
}

// One attached Document Vault file in the staff review modal: what it proves,
// the value declared at upload against the value the application declared
// (getDocumentProofReview: the frozen snapshot), and, for
// the Admissions Office (when `onChangeDocument` is passed), the verification
// actions. `openUrl` adds the signed-URL escape hatch beside those actions, so
// the review pane can keep it at the top of the pane. Department Chairs get the
// same details read-only. `as` lets the review modal's preview pane render it
// outside a list.
export function DocumentVerificationItem({ doc, application, owner = null, onPreview, onChangeDocument, openUrl = '', as: Element = 'li' }) {
  const proofs = getDocumentProofReview(doc, application, { owner });
  // A decision can be corrected (reset to Pending) only while the application is
  // still before endorsement; protect_verified_documents_on_progress refuses it
  // once the file has carried the application past verification.
  const canReset = DOCUMENT_REPLACEMENT_STATUSES.includes(application?.status);
  return (
    <Element className="grid gap-2 border-b border-app-border/60 pb-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
        <div className="min-w-0 w-full flex-1">
          <span className="block text-sm text-app-text">{doc.title}</span>
          <span className="block text-xs text-app-muted [overflow-wrap:anywhere]">{doc.fileName ? `${doc.fileName} · ` : ''}{getDocumentTypeLabel(doc.documentType)}</span>
        </div>
        <StatusBadge tone={verificationTone(doc.verificationStatus)} className="shrink-0">{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
      </div>
      <DocumentRejectionReason doc={doc} />
      <DocumentDecisionRecord doc={doc} />
      {isPhotoDocumentType(doc.documentType) ? (
        <p className="m-0 rounded-xl border border-sky-400/30 bg-sky-500/5 px-3 py-2 text-xs text-app-muted">
          {doc.documentType === 'Photos of Residence'
            ? 'Check that the residence is clear, inside and out, with no people.'
            : 'Check that the photo is recent, sharp, and unobstructed.'}
        </p>
      ) : null}
      {proofs.length ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Proves</span>
          {proofs.map((proof) => (
            <span key={proof.key} className="inline-flex flex-wrap items-center gap-1">
              <StatusBadge tone="info">{proof.label}</StatusBadge>
              {proof.hasAttested ? <span className="min-w-0 text-xs text-app-muted [overflow-wrap:anywhere]">Declared at upload: {formatProofValue(proof.key, proof.attested)}</span> : null}
              {proof.hasDeclared && (!proof.hasAttested || proof.staleReason === 'value') ? (
                <span className="min-w-0 text-xs text-app-muted [overflow-wrap:anywhere]">{proof.source === 'snapshot' ? 'Application snapshot' : 'Profile now'}: {formatProofValue(proof.key, proof.declared)}</span>
              ) : null}
              {proof.staleReason ? (
                <StatusBadge tone="danger">{proof.staleReason === 'year' ? 'Outdated · earlier academic year' : proof.source === 'snapshot' ? 'Mismatch · snapshot differs' : 'Outdated · profile changed'}</StatusBadge>
              ) : null}
            </span>
          ))}
          {!proofs.some((proof) => proof.hasAttested || proof.hasDeclared) && (
            <span className="text-xs text-app-muted">Declared values are in the student’s profile snapshot.</span>
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
              <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, 'Rejected')}>Revert for resubmission</Button>
            ) : null}
            {doc.verificationStatus !== 'Pending' && canReset ? (
              <Button type="button" className="!min-h-8 !px-2 !py-1 !text-xs" onClick={() => onChangeDocument(doc.id, 'Pending')}>Reset to pending</Button>
            ) : null}
          </>
        ) : null}
        {/* The file's escape hatch sits with the decision actions so a reviewer
            never has to scroll past the preview to open the original. */}
        {openUrl ? (
          <a className="link-btn !min-h-8 !px-2 !py-1 !text-xs" href={openUrl} target="_blank" rel="noreferrer">Open in a new tab</a>
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
      {verification ? <StatusBadge tone={getAttributeVerificationTone(verification)} title={describeAttributeVerification(getAttributeVerificationLabel(verification))}>{getAttributeVerificationLabel(verification)}</StatusBadge> : null}
    </span>
  </div>
);

const SnapshotRows = ({ rows }) => rows.map((row) => <SnapshotRow key={row.label} {...row} />);

// A signed URL lasts an hour, and the same vault file can be rendered more than
// once in a session (a re-render of the snapshot block, or another surface that
// shows the same photo). One signature per object path keeps the thumbnail from
// re-requesting it every time it remounts, and it is discarded shortly before
// the URL would expire.
const SIGNED_URL_REUSE_MS = 55 * 60 * 1000;
const photoUrlCache = new Map();
const signedPhotoUrl = (storagePath) => {
  const cached = photoUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  photoUrlCache.delete(storagePath);
  const request = getSupabaseDocumentUrl(storagePath)
    .catch(() => ({ url: null, error: true }))
    .then((result) => {
      if (!result?.url) photoUrlCache.delete(storagePath);
      return result;
    });
  photoUrlCache.set(storagePath, { request, expiresAt: Date.now() + SIGNED_URL_REUSE_MS });
  return request;
};

// A vault image read through the same short-lived signed URL, with no frame of
// its own. The printable application uses it for the residence photos and tells
// the print button when the picture has loaded (or failed) through `onSettled`.
export function SignedVaultImage({ doc, alt, className = '', onSettled }) {
  const [state, setState] = useState({ url: '', error: false });
  const storagePath = doc?.storagePath || '';

  useEffect(() => {
    let active = true;
    setState({ url: '', error: false });
    if (!storagePath) {
      onSettled?.();
      return () => { active = false; };
    }
    signedPhotoUrl(storagePath).then(({ url, error }) => {
      if (!active) return;
      if (error || !url) {
        setState({ url: '', error: true });
        onSettled?.();
      } else {
        setState({ url, error: false });
      }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath]);

  if (state.url && !state.error) {
    return <img src={state.url} alt={alt} className={className} onLoad={() => onSettled?.()} onError={() => { setState({ url: '', error: true }); onSettled?.(); }} />;
  }
  return <span className="grid h-full w-full place-items-center px-2 text-center text-[10pt] text-neutral-600">{state.error || !storagePath ? 'Photo unavailable' : 'Loading photo…'}</span>;
}

// The applicant's 2x2 ID photo, framed square and read from the private
// Document Vault bucket through a short-lived signed URL. It is the photograph
// submitted with the application, never the personal profile photo, which is
// owner-only and deliberately not shared with reviewers. A missing or
// unreadable file shows a readable placeholder instead of a broken picture, and
// clicking it opens the full document preview where the surface provides one.
export function ApplicantPhotoThumb({ doc = null, onPreview, className = '' }) {
  const [state, setState] = useState({ url: '', error: '' });
  const storagePath = doc?.storagePath || '';

  useEffect(() => {
    let active = true;
    if (!storagePath) {
      setState({ url: '', error: '' });
      return () => { active = false; };
    }
    setState({ url: '', error: '' });
    signedPhotoUrl(storagePath).then(({ url, error }) => {
      if (!active) return;
      setState(error || !url
        ? { url: '', error: 'The 2x2 photo could not be opened.' }
        : { url, error: '' });
    });
    return () => { active = false; };
  }, [storagePath]);

  const frame = `grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[14px] border p-1 text-center text-[10px] leading-tight text-app-muted sm:h-24 sm:w-24 ${doc ? 'border-app-border bg-app-surface' : 'border-dashed border-app-border bg-app-surface/60'} ${className}`;
  // A 2x2 photo is always a normalized JPEG, so a file that is not an image (or
  // has no stored object) cannot be rendered and says so instead of looping on
  // the loading state.
  const viewable = Boolean(storagePath) && (!doc?.fileName || isImageFileName(doc.fileName));
  const content = doc ? (
    !viewable
      ? <span className="grid place-items-center gap-1 px-1"><Camera aria-hidden="true" className="h-4 w-4" />Photo unavailable</span>
      : state.url && !state.error
        ? <img src={state.url} alt="Recent 2x2 ID photo of the applicant" className="h-full w-full rounded-[10px] object-cover" onError={() => setState({ url: '', error: 'The 2x2 photo could not be opened.' })} />
        : <span className="grid place-items-center gap-1 px-1"><Camera aria-hidden="true" className="h-4 w-4" />{state.error ? 'Photo unavailable' : 'Loading photo…'}</span>
  ) : (
    <span className="grid place-items-center gap-1 px-1"><Camera aria-hidden="true" className="h-4 w-4" />2x2 photo not attached</span>
  );

  if (!doc || !onPreview) return <span className={frame}>{content}</span>;
  return (
    <button
      type="button"
      onClick={() => onPreview(doc)}
      aria-label="Open the applicant 2x2 photo"
      className={`${frame} cursor-pointer transition hover:border-blue-500/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20`}
    >
      {content}
    </button>
  );
}

// Values are self-reported; a badge only reflects Document Vault proof reviewed
// by the Admissions Office, never a Registrar record. The answers the
// application needs stay open; the other groups fold so long snapshots stay
// scannable on a phone and in the review modal. `expanded` opens every group,
// for the workspace step where the student checks what they are about to send.
// `applicantPhoto` is the 2x2 ID photo the application currently attaches
// (getApplicantPhotoDocument), shown first so the applicant is recognized at a
// glance; `onPreviewPhoto` opens the full document where the surface has one.
export function ProfileSnapshotList({ snapshot, expanded = false, applicantPhoto = null, onPreviewPhoto, extraSections = [] }) {
  if (!snapshot) return <p className="m-0 text-sm text-app-muted">No profile snapshot was recorded.</p>;
  const { legacy, sections } = getProfileSnapshotSections(snapshot);
  const [primary, ...snapshotGroups] = sections;
  // Office-only financial groups are passed in by a surface that may show them.
  const groups = [...snapshotGroups, ...extraSections];
  return (
    <div className="grid">
      <div className="flex min-w-0 flex-wrap items-start gap-3 border-b border-app-border/60 pb-3">
        <ApplicantPhotoThumb doc={applicantPhoto} onPreview={onPreviewPhoto} />
        <div className="grid min-w-0 gap-1">
          <strong className="text-base text-app-text">{snapshot.fullName || 'Name not encoded'}</strong>
          <span className="text-xs text-app-muted">
            {[snapshot.yearStandingLabel, snapshot.degreeProgram].filter(Boolean).join(' · ') || 'Year standing not recorded'}
          </span>
          {applicantPhoto ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-muted">
              <StatusBadge tone={verificationTone(applicantPhoto.verificationStatus)}>{getDocumentStatusLabel(applicantPhoto.verificationStatus)}</StatusBadge>
              <span>Recent 2x2 ID photo · from the Document Vault</span>
            </span>
          ) : <span className="text-xs text-app-muted">Recent 2x2 ID photo · not attached</span>}
          {applicantPhoto?.verificationStatus === 'Rejected' ? <DocumentRejectionReason doc={applicantPhoto} /> : null}
        </div>
      </div>
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
      {legacy ? <p className="m-0 pt-2 text-xs text-app-muted">Submitted before the extended profile details were recorded.</p> : null}
      {snapshot.capturedAt ? <p className="m-0 pt-2 text-xs text-app-muted">Self-reported values as of {fmtDate(snapshot.capturedAt)}.</p> : null}
    </div>
  );
}
