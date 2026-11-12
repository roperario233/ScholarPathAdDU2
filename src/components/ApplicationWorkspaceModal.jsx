import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock, Camera, Check, CheckCircle2, ChevronDown, CircleDashed, ClipboardCheck, FileText, FolderOpen, PenLine, ShieldCheck, UserRound, Wallet } from 'lucide-react';
import { Button, Collapse, ModalShell, Panel, RequiredMark, StatusBadge } from './ui';
import { SkeletonRegion, SkeletonRows, SkeletonText } from './Skeleton';
import DocumentPreviewModal from './DocumentPreviewModal';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import ApplicationFinancialStep from './ApplicationFinancialStep';
import { DocumentRejectionReason, ProfileSnapshotList, RequirementStateBadge } from './ApplicationParts';
import { buildProfileSnapshot, describeRequirementTypes, getApplicantPhotoDocument, getApplicationAttributeVerifications, getApplicationReadiness, getMatchingVaultDocuments, getResidencePhotoDocuments } from '../lib/applicationRequirements';
import { getDocumentStatusLabel, getDocumentTypeLabel, isPhotoDocumentType } from '../lib/constants';
import { AFFIDAVIT_CLAUSES, DATA_PRIVACY_NOTICE, ESSAY_INSTRUCTION, ESSAY_TARGET_WORDS, ESSAY_TOPIC, countWords } from '../lib/applicationForm';
import { getFinancialAnswersMissing, getFinancialDetailSections, normalizeFinancialAnswers } from '../lib/financialDetails';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';
import { PHOTO_ACCEPT, photoRequirementNeedsCamera } from '../lib/photoGuide';
import { APPLICATION_FORM_BLOCKER_PREFIX, ESSAY_MAX_LENGTH, getVerifiableAttributeOption } from '../lib/profile';
import { fmtDate } from '../lib/formatters';

const STEPS = [
  { key: 'documents', label: 'Required documents', icon: FileText, intro: 'Attach one file per requirement. Uploads go to your Document Vault and can be reused.' },
  // The application form is My Profile, frozen into the profile snapshot at submit.
  { key: 'profile', label: 'Application form', icon: UserRound, intro: 'Your Application Form answers, frozen on submit. The Admissions Office and your Department Chair see the profile values; the household finances and financial situation go to the Admissions Office only.' },
  { key: 'financial', label: 'Financial situation', icon: Wallet, intro: null },
  { key: 'statement', label: 'Statement', icon: PenLine, intro: null },
  { key: 'review', label: 'Review and submit', icon: ClipboardCheck, intro: 'Check that everything is in place, then certify and submit.' },
];

// How each requirement state reads at a glance: a rows that still needs the
// student's action stays open with an amber or rose accent, a row that already
// has its file folds down to one line with a green check.
const REQUIREMENT_VISUALS = {
  missing: { Icon: CircleDashed, needsAction: true, accent: 'border-l-amber-400', icon: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  attached: { Icon: CheckCircle2, needsAction: false, accent: 'border-l-emerald-500', icon: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  verified: { Icon: CheckCircle2, needsAction: false, accent: 'border-l-emerald-500', icon: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  rejected: { Icon: AlertCircle, needsAction: true, accent: 'border-l-rose-500', icon: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  outdated: { Icon: AlertCircle, needsAction: true, accent: 'border-l-rose-500', icon: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
};

const getRequirementVisual = (state) => REQUIREMENT_VISUALS[state] || REQUIREMENT_VISUALS.missing;

const requirementAnchor = (requirement) => `requirement-${requirement.id}`;

// The one line a requirement shows while it is folded: what is attached, or what
// the student still has to do.
function describeRequirementSummary(requirement, hasVaultMatch) {
  if (requirement.state === 'rejected') return 'Reverted by the Admissions Office. Upload a replacement.';
  if (requirement.state === 'outdated') return 'Outdated after a change to your Application Form. Upload a current proof.';
  if (requirement.attached.length) {
    const [first, ...rest] = requirement.attached;
    return `${first.title}${first.fileName ? ` · ${first.fileName}` : ''}${rest.length ? ` · +${rest.length} more` : ''}`;
  }
  return hasVaultMatch ? 'Not attached yet. A matching file is already in your Document Vault.' : 'Not attached yet. Upload a file or pick one from your Document Vault.';
}

const PROFILE_STEP_INDEX = STEPS.findIndex((entry) => entry.key === 'profile');

// The certification doubles as the student's consent to share the application
// with the reviewers who handle it.
const CERTIFICATION_TEXT = 'I certify that the information and documents I provided are true and complete, and I agree to share them with the Admissions Office and my Department Chair for this application. My household finances and financial situation answers go to the Admissions Office only.';

// One required document: what it accepts, what is attached, and the ways to
// satisfy it - reuse a Document Vault file, upload a new one into the vault, or
// take a photo with the camera when the requirement accepts a photo type.
function RequirementRow({ requirement, documents, attachedIds, busy, error, onAttach, onDetach, onUpload, onPreview }) {
  const [uploadType, setUploadType] = useState(requirement.documentTypes[0]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const reusable = getMatchingVaultDocuments(requirement, documents).filter((doc) => !attachedIds.includes(doc.id));
  // Files the student can attach right now; a reverted file cannot be reused.
  const readyFiles = reusable.filter((doc) => doc.verificationStatus !== 'Rejected');
  // A single-type photo requirement (the applicant photo and the residence
  // photos) can be satisfied with the camera; a mixed list offers it only for the
  // photo type currently selected.
  const photoType = isPhotoDocumentType(uploadType)
    ? uploadType
    : requirement.documentTypes.length === 1 && photoRequirementNeedsCamera(requirement)
      ? requirement.documentTypes[0]
      : '';
  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(requirement, { file, documentType: uploadType });
  };

  // A camera capture is already a normalized JPEG. The upload runs through the
  // same vault-first path as a file-picker choice, so it stays reusable.
  const useCameraPhoto = (file) => {
    onUpload(requirement, { file, documentType: photoType });
    return { ok: true };
  };

  const visual = getRequirementVisual(requirement.state);
  const StateIcon = visual.Icon;
  // A row that needs the student stays open; one that has its file folds to a
  // line. The row follows its own state, so attaching a file folds it and
  // removing the file opens it again, while a manual toggle is respected until
  // the state next changes.
  const bodyId = useId();
  const [open, setOpen] = useState(visual.needsAction);
  const [seenNeedsAction, setSeenNeedsAction] = useState(visual.needsAction);
  if (seenNeedsAction !== visual.needsAction) {
    setSeenNeedsAction(visual.needsAction);
    setOpen(visual.needsAction);
  }

  return (
    <li id={requirementAnchor(requirement)} className={`scroll-mt-3 rounded-2xl border border-l-4 border-app-border bg-app-surface ${visual.accent}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        className="flex cursor-pointer items-center gap-3 rounded-2xl p-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
      >
          <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${visual.icon}`}><StateIcon size={18} /></span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-sm font-bold text-app-text">{requirement.label}</span>
            <span className={`text-xs [overflow-wrap:anywhere] ${visual.needsAction ? 'font-medium text-app-text/80' : 'text-app-muted'}`}>{describeRequirementSummary(requirement, readyFiles.length > 0)}</span>
          </span>
          <span className="hidden shrink-0 sm:block"><RequirementStateBadge state={requirement.state} /></span>
          <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-app-muted transition-transform duration-300 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </div>
        <Collapse open={open} id={bodyId}>
        <div className="grid gap-3 px-4 pb-4">
      <div className="sm:hidden"><RequirementStateBadge state={requirement.state} /></div>
      <div className="grid gap-1 border-t border-app-border/60 pt-3">
        <p className="m-0 text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)} · any one is enough</p>
        {requirement.proves?.length ? (
          <p className="m-0 text-xs text-app-muted">
            Proves your {requirement.proves.map((key) => getVerifiableAttributeOption(key)?.label || key).join(' and ')} as declared in your Application Form
          </p>
        ) : null}
        {requirement.note ? <p className="m-0 text-xs text-app-muted">{requirement.note}</p> : null}
      </div>

      {requirement.attached.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {requirement.attached.map((doc) => (
            <li key={doc.id} className="grid min-w-0 gap-2 rounded-xl border border-app-border/70 px-3 py-3">
              <span className="block min-w-0 text-sm text-app-text">{doc.title}<span className="mt-0.5 block text-xs text-app-muted [overflow-wrap:anywhere]">{doc.fileName}</span></span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
                <Button type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button>
                <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 !text-xs" disabled={busy} onClick={() => onDetach(requirement, doc.id)}>Remove</Button>
              </span>
              <DocumentRejectionReason doc={doc} className="w-full" />
            </li>
          ))}
        </ul>
      ) : null}

      {readyFiles.length && !['attached', 'verified'].includes(requirement.state) ? (
        <div className="grid gap-1.5" role="group" aria-label={`Files in your Document Vault for ${requirement.label}`}>
          <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-app-muted">
            <FolderOpen size={14} aria-hidden="true" className="shrink-0" />
            {readyFiles.length === 1 ? 'Already in your Document Vault' : `${readyFiles.length} files already in your Document Vault`}
          </p>
          <ul className="m-0 grid gap-1.5 p-0">
            {readyFiles.slice(0, 3).map((doc) => (
              <li key={doc.id} className="flex min-w-0 flex-col gap-1 rounded-lg border border-app-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="block min-w-0 text-sm text-app-text">{doc.title}<span className="ml-2 text-xs text-app-muted [overflow-wrap:anywhere]">{getDocumentStatusLabel(doc.verificationStatus)} · {fmtDate(doc.uploadedAt)}</span></span>
                <span className="flex shrink-0 gap-2">
                  <Button type="button" variant="ghost" className="!min-h-8 !px-2.5 !py-0.5 !text-xs" onClick={() => onPreview(doc)}>View</Button>
                  <Button type="button" className="!min-h-8 !px-2.5 !py-0.5 !text-xs" disabled={busy} onClick={() => onAttach(requirement, doc.id)}>Use</Button>
                </span>
              </li>
            ))}
          </ul>
          {readyFiles.length > 3 ? <p className="m-0 text-xs text-app-muted">{readyFiles.length - 3} more in the list below.</p> : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>Choose from your Document Vault</span>
          <select
            value=""
            disabled={busy || !reusable.length}
            onChange={(event) => { if (event.target.value) onAttach(requirement, event.target.value); }}
            aria-label={`Choose a vault file for ${requirement.label}`}
          >
            <option value="">{reusable.length ? 'Select a file…' : 'No matching files in your vault'}</option>
            {reusable.map((doc) => (
              <option key={doc.id} value={doc.id} disabled={doc.verificationStatus === 'Rejected'}>
                {doc.title} · {getDocumentStatusLabel(doc.verificationStatus)} · {fmtDate(doc.uploadedAt)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>{requirement.state === 'rejected' ? 'Upload a replacement' : photoType ? 'Or take or upload a photo' : 'Or upload a new file'}</span>
          <div className="flex min-w-0 flex-wrap gap-2">
            {requirement.documentTypes.length > 1 ? (
              <select className="min-w-0 flex-1" value={uploadType} onChange={(event) => setUploadType(event.target.value)} aria-label={`Document type for ${requirement.label}`} disabled={busy}>
                {requirement.documentTypes.map((type) => <option key={type} value={type}>{getDocumentTypeLabel(type)}</option>)}
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
      {photoType ? <PhotoGuide documentType={photoType} defaultOpen={requirement.state !== 'attached' && requirement.state !== 'verified'} /> : null}
      {error ? <p className="form-error m-0" role="alert">{error}</p> : null}
      {cameraOpen ? (
        <PhotoCaptureModal
          title={photoType === 'Photos of Residence' ? 'Take a photo of your residence' : 'Take your 2x2 ID photo'}
          documentType={photoType}
          onUsePhoto={useCameraPhoto}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
        </div>
        </Collapse>
    </li>
  );
}

// The documents step's overview: how many requirements are covered, which ones
// still need a file (each a link that jumps to its row).
function DocumentsOverview({ requirements }) {
  const total = requirements.length;
  const todo = requirements.filter((item) => getRequirementVisual(item.state).needsAction);
  const done = total - todo.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const jump = (event, requirement) => {
    event.preventDefault();
    const target = document.getElementById(requirementAnchor(requirement));
    if (!target) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className={`grid gap-3 rounded-2xl border p-4 ${todo.length ? 'border-app-border bg-app-surface' : 'border-emerald-400/40 bg-emerald-500/10'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <strong className="text-sm text-app-text">
          {todo.length ? `${done} of ${total} documents attached` : `All ${total} documents attached`}
        </strong>
        <span className="text-xs font-medium text-app-muted">
          {todo.length ? `${todo.length} still ${todo.length === 1 ? 'needs' : 'need'} your attention` : 'Nothing left to attach. Continue to the next step.'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-app-border" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Required documents attached">
        <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${todo.length ? 'bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
      </div>
      {todo.length ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Still to do</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {todo.map((item) => {
              const needsFix = item.state === 'rejected' || item.state === 'outdated';
              return (
                <li key={item.id} className="min-w-0 max-w-full">
                  <a
                    href={`#${requirementAnchor(item)}`}
                    onClick={(event) => jump(event, item)}
                    title={item.label}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold no-underline transition hover:-translate-y-px focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${needsFix ? 'border-rose-400/50 bg-rose-500/10 text-rose-800 dark:text-rose-200' : 'border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-200'}`}
                  >
                    {needsFix ? <AlertCircle size={12} aria-hidden="true" className="shrink-0" /> : <CircleDashed size={12} aria-hidden="true" className="shrink-0" />}
                    <span className="min-w-0 truncate">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// A step's title block: which step this is, what it does, and one line of help.
function StepIntro({ index, children }) {
  const { icon: Icon, label } = STEPS[index];
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><Icon size={20} /></span>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">Step {index + 1} of {STEPS.length}</span>
        <h3 className="m-0 text-lg font-bold text-app-text">{label}</h3>
        {children ? <p className="m-0 text-sm text-app-muted">{children}</p> : null}
      </div>
    </div>
  );
}

const SUPPORTING_KEY = { id: 'supporting' };

// Optional vault files beyond the requirements, such as proof of a profile
// answer. Files of a required type are offered on their requirement row instead,
// so a file is never listed in both places.
function SupportingDocumentsBlock({ readiness, documents, attachedIds, busy, error, onAttach, onDetach, onPreview }) {
  const candidates = documents.filter((doc) => (
    !attachedIds.includes(doc.id)
    && doc.verificationStatus !== 'Rejected'
    && !readiness.requirements.some((requirement) => requirement.documentTypes.includes(doc.documentType))
  ));
  const proofs = candidates.filter((doc) => doc.linkedAttributes?.length);
  const others = candidates.filter((doc) => !doc.linkedAttributes?.length);
  const optionFor = (doc) => <option key={doc.id} value={doc.id}>{doc.title} · {getDocumentStatusLabel(doc.verificationStatus)} · {fmtDate(doc.uploadedAt)}</option>;

  return (
    <section className="grid gap-3 rounded-2xl border border-dashed border-app-border bg-app-surface/60 p-4" aria-label="Additional supporting documents">
      <div className="grid gap-1">
        <h4 className="m-0 text-sm font-bold text-app-text">Additional supporting documents (optional)</h4>
        <p className="m-0 text-xs text-app-muted">Optional Document Vault files that support your application. They do not block submission.</p>
      </div>
      {readiness.supportingDocuments.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {readiness.supportingDocuments.map((doc) => (
            <li key={doc.id} className="grid min-w-0 gap-2 rounded-xl border border-app-border/70 px-3 py-3">
              <span className="block min-w-0 text-sm text-app-text">{doc.title}<span className="mt-0.5 block text-xs text-app-muted [overflow-wrap:anywhere]">{doc.fileName}</span></span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
                <Button type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button>
                <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 !text-xs" disabled={busy} onClick={() => onDetach(doc.id)}>Remove</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="grid content-start gap-1 text-xs font-semibold text-app-muted sm:max-w-md">
        <span>Add from your Document Vault</span>
        <select
          value=""
          disabled={busy || !candidates.length}
          onChange={(event) => { if (event.target.value) onAttach(event.target.value); }}
          aria-label="Choose a supporting file from your Document Vault"
        >
          <option value="">{candidates.length ? 'Select a file…' : 'No other files in your vault'}</option>
          {proofs.length ? <optgroup label="Proofs of your profile answers">{proofs.map(optionFor)}</optgroup> : null}
          {others.length ? <optgroup label="Other vault files">{others.map(optionFor)}</optgroup> : null}
        </select>
      </label>
      {error ? <p className="form-error m-0" role="alert">{error}</p> : null}
    </section>
  );
}

// The application workspace for a Draft: attach each required document from the
// Document Vault, review the self-reported profile snapshot, write the
// statement, then certify and submit. Submit stays disabled until the shared
// readiness check (src/lib/applicationRequirements.js) passes.
export default function ApplicationWorkspaceModal({
  application,
  scholarship,
  documents,
  profile,
  financialAnswers: savedFinancialAnswers,
  financialLoaded = true,
  onAttach,
  onDetach,
  onUploadAndAttach,
  onSaveDraft,
  onSubmit,
  onSaveProfile,
  onOpenProfile,
  onClose,
  // Called with the application id once the submission is saved, so the page
  // can show the Submitted confirmation in place of this workspace (which only
  // renders for a Draft).
  onSubmitted,
  // Opens the full privacy documents over this dialog, so a half-finished draft is
  // never lost by following the notice link.
  onOpenPrivacyDocument = null,
}) {
  const [step, setStep] = useState(0);
  const stepContentRef = useRef(null);
  const previousStepRef = useRef(step);
  // A draft started before statements existed falls back to the profile essay.
  const [savedStatement, setSavedStatement] = useState(() => application.statement || profile?.essay || '');
  const [statement, setStatement] = useState(savedStatement);
  // The per-application financial situation answers (office-only). Saved with
  // the draft in application_financial_details.
  const [savedFinancial, setSavedFinancial] = useState(() => normalizeFinancialAnswers(savedFinancialAnswers || {}));
  const [financialAnswers, setFinancialAnswers] = useState(savedFinancial);
  const [financialMessage, setFinancialMessage] = useState('');
  // The financial answers load after the workspace. A modal opened before they
  // arrive seeds its draft from them once, so saved answers never read blank.
  const financialSeededRef = useRef(financialLoaded);
  useEffect(() => {
    if (!financialLoaded || financialSeededRef.current) return;
    financialSeededRef.current = true;
    const seeded = normalizeFinancialAnswers(savedFinancialAnswers || {});
    setSavedFinancial(seeded);
    setFinancialAnswers(seeded);
  }, [financialLoaded, savedFinancialAnswers]);
  const [certified, setCertified] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [busyRequirement, setBusyRequirement] = useState('');
  const [rowErrors, setRowErrors] = useState({});
  const [statementMessage, setStatementMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState(null);

  const readiness = useMemo(() => getApplicationReadiness({
    application: { ...application, statement },
    scholarship,
    documents,
    profile,
    financialAnswers,
    certified,
  }), [application, statement, scholarship, documents, profile, financialAnswers, certified]);
  // The badges come from the files this application attaches, exactly as the
  // submission will freeze them.
  const snapshot = useMemo(
    () => buildProfileSnapshot(profile, getApplicationAttributeVerifications(application, documents, profile)),
    [profile, application, documents],
  );
  const isStatementDirty = statement !== savedStatement;
  const financialMissing = useMemo(() => getFinancialAnswersMissing(financialAnswers), [financialAnswers]);
  const isFinancialDirty = JSON.stringify(normalizeFinancialAnswers(financialAnswers)) !== JSON.stringify(savedFinancial);
  const financialSections = useMemo(
    () => getFinancialDetailSections({ financialProfile: profile?.financialProfile, answers: financialAnswers, family: profile?.familyDetails || {}, householdIncome: profile?.householdIncome }),
    [profile, financialAnswers],
  );
  const wordCount = countWords(statement);
  const eligibilityBlockers = readiness.blockers.filter((blocker) => blocker.startsWith('Eligibility:'));
  const documentsDone = readiness.requirements.every((item) => item.state === 'attached' || item.state === 'verified');
  // `readiness.attachedCount` counts every requirement that has a file, including a
  // reverted or outdated one. Students read "12 of 12 attached" as finished, so the
  // workspace counts only the files that actually cover their requirement.
  const coveredDocumentCount = readiness.requirements.filter((item) => item.state === 'attached' || item.state === 'verified').length;
  const profileBlockers = readiness.blockers.filter((blocker) => blocker.startsWith(APPLICATION_FORM_BLOCKER_PREFIX) || blocker.startsWith('Set your year standing'));
  const supportingCount = readiness.supportingDocuments.length;
  // Distinct files being sent: one file can satisfy two requirements, so count ids.
  const sharedDocumentCount = new Set([
    ...readiness.requirements.flatMap((requirement) => requirement.attached.map((doc) => doc.id)),
    ...readiness.supportingDocuments.map((doc) => doc.id),
  ]).size;

  const stepDone = {
    documents: documentsDone,
    profile: eligibilityBlockers.length === 0 && profileBlockers.length === 0,
    financial: financialMissing.length === 0,
    statement: Boolean(statement.trim()),
    review: readiness.ready,
  };
  const sectionsDone = ['documents', 'profile', 'financial', 'statement'].filter((key) => stepDone[key]).length;

  const runRowAction = async (requirement, action) => {
    setBusyRequirement(requirement.id);
    setRowErrors((previous) => ({ ...previous, [requirement.id]: '' }));
    const result = await action();
    setBusyRequirement('');
    if (result?.error) setRowErrors((previous) => ({ ...previous, [requirement.id]: result.error }));
  };

  const handleUpload = (requirement, { file, documentType }) => {
    if (file.size > DOCUMENT_MAX_BYTES) {
      setRowErrors((previous) => ({ ...previous, [requirement.id]: 'Files must be 10 MB or smaller.' }));
      return;
    }
    runRowAction(requirement, () => onUploadAndAttach(application.id, { file, documentType }));
  };

  const saveFinancial = async () => {
    setFinancialMessage('');
    const normalized = normalizeFinancialAnswers(financialAnswers);
    const result = await onSaveDraft(application.id, { statement: savedStatement, financialAnswers: normalized });
    if (!result?.error) {
      setFinancialAnswers(normalized);
      setSavedFinancial(normalized);
    }
    setFinancialMessage(result?.error || 'Financial situation saved.');
  };

  const saveStatement = async () => {
    setStatementMessage('');
    const result = await onSaveDraft(application.id, { statement });
    if (!result?.error) setSavedStatement(statement);
    setStatementMessage(result?.error || 'Draft saved.');
  };

  // The profile's default statement/essay is a reusable template: it can replace this
  // draft's text, or this text can become the default for future applications.
  const defaultStatement = String(profile?.essay || '');

  const applyDefaultStatement = () => {
    if (statement.trim() && !window.confirm('Replace this statement with your default statement/essay from your Application Form?')) return;
    setStatement(defaultStatement);
    setStatementMessage('');
  };

  const saveAsDefault = async () => {
    setStatementMessage('');
    const result = await onSaveProfile({ essay: statement.trim() });
    setStatementMessage(result?.success ? 'Saved as your default statement/essay.' : result?.message || 'Unable to save your default statement/essay.');
  };

  const handleClose = () => {
    if ((isStatementDirty || isFinancialDirty) && !window.confirm('Discard your unsaved changes to this application?')) return;
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitError('');
    setIsSubmitting(true);
    const result = await onSubmit(application.id, { statement, certified, financialAnswers });
    setIsSubmitting(false);
    if (result?.error) { setSubmitError(result.error); return; }
    onSubmitted?.(application.id);
    onClose();
  };

  const current = STEPS[step].key;
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const target = stepContentRef.current;
    if (!target) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof target.scrollTo !== 'function') target.scrollTop = 0;
    else target.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  // Requirements still open that a non-reverted vault file could satisfy.
  const vaultReadyCount = readiness.requirements.filter((requirement) => (
    !['attached', 'verified'].includes(requirement.state)
    && getMatchingVaultDocuments(requirement, documents).some((doc) => !(application.attachedDocuments || []).includes(doc.id) && doc.verificationStatus !== 'Rejected')
  )).length;

  return (
    <>
      {/* A fixed height, so the dialog keeps one size from step to step; the body
          scrolls and the Back / Next / Submit row stays pinned at the bottom. */}
      <ModalShell
        title={`${application.scholarshipTitle} Application`}
        onClose={handleClose}
        className="application-detail-modal !h-[min(92vh,920px)] !w-[min(1080px,100%)] !max-h-[min(92vh,920px)] max-sm:!h-[calc(100dvh-1.5rem)] max-sm:!max-h-[calc(100dvh-1.5rem)]"
        header={(
          <div className="mb-4 grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="grid min-w-0 gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">Application workspace</span>
                <h2 className="m-0 min-w-0 text-xl leading-tight [overflow-wrap:anywhere]">{application.scholarshipTitle} Application</h2>
              </div>
              <Button variant="secondary" type="button" className="shrink-0" onClick={handleClose}>Close</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-app-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-3 py-1"><CalendarClock size={13} aria-hidden="true" />Deadline {fmtDate(scholarship?.deadline)}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors duration-500 ${sectionsDone === 4 ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'border-app-border bg-app-surface'}`}>
                {sectionsDone === 4 ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
                {sectionsDone} of 4 sections complete
              </span>
            </div>
          </div>
        )}
      >
        <div ref={stepContentRef} className="application-detail-modal-body grid content-start gap-4">
          <ol className="m-0 grid grid-cols-2 gap-2 p-0 sm:grid-cols-5" aria-label="Application steps">
            {STEPS.map((entry, index) => {
              const isActive = index === step;
              const done = stepDone[entry.key];
              return (
                <li key={entry.key} className="list-none">
                  <button
                    type="button"
                    onClick={() => setStep(index)}
                    aria-current={isActive ? 'step' : undefined}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${isActive ? 'border-blue-500/60 bg-blue-500/10 text-app-text' : 'border-app-border bg-app-surface text-app-muted hover:text-app-text'}`}
                  >
                    <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.7rem] ${done ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-app-muted-surface text-app-muted'}`}>{done ? <Check size={13} strokeWidth={3} /> : index + 1}</span><span className="sr-only">{done ? ' (complete)' : ''}</span>
                    <span className="min-w-0">{entry.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Keyed by step, so each step eases in instead of swapping instantly. */}
          <div key={current} className="profile-section-enter grid content-start gap-4">
          {current === 'documents' && (
            <section className="grid gap-3" aria-label="Required documents">
              <StepIntro index={0}>{STEPS[0].intro}</StepIntro>
              {readiness.requirements.length ? <DocumentsOverview requirements={readiness.requirements} /> : null}
              {vaultReadyCount ? (
                <p className="m-0 flex items-center gap-1.5 rounded-xl border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-app-text" role="status">
                  <FolderOpen size={14} aria-hidden="true" className="shrink-0" />
                  {vaultReadyCount === 1 ? '1 requirement has' : `${vaultReadyCount} requirements have`} a matching file already in your Document Vault. Open it and choose Use.
                </p>
              ) : null}
              {readiness.requirements.length ? (
                <ul className="m-0 grid list-none gap-3 p-0">
                  {readiness.requirements.map((requirement) => (
                    <RequirementRow
                      key={requirement.id}
                      requirement={requirement}
                      documents={documents}
                      attachedIds={application.attachedDocuments || []}
                      busy={busyRequirement === requirement.id}
                      error={rowErrors[requirement.id]}
                      onAttach={(item, documentId) => runRowAction(item, () => onAttach(application.id, documentId))}
                      onDetach={(item, documentId) => runRowAction(item, () => onDetach(application.id, documentId))}
                      onUpload={handleUpload}
                      onPreview={setPreview}
                    />
                  ))}
                </ul>
              ) : <p className="m-0 text-sm text-app-muted">This program does not list required documents.</p>}
              <SupportingDocumentsBlock
                readiness={readiness}
                documents={documents}
                attachedIds={application.attachedDocuments || []}
                busy={busyRequirement === SUPPORTING_KEY.id}
                error={rowErrors[SUPPORTING_KEY.id]}
                onAttach={(documentId) => runRowAction(SUPPORTING_KEY, () => onAttach(application.id, documentId))}
                onDetach={(documentId) => runRowAction(SUPPORTING_KEY, () => onDetach(application.id, documentId))}
                onPreview={setPreview}
              />
            </section>
          )}

          {current === 'profile' && (
            <section className="grid gap-3" aria-label="Application form">
              <StepIntro index={1}>{STEPS[1].intro}</StepIntro>
              <Panel><ProfileSnapshotList snapshot={snapshot} expanded applicantPhoto={getApplicantPhotoDocument(application, documents)} residencePhotos={getResidencePhotoDocuments(application, documents)} onPreviewPhoto={setPreview} extraSections={financialSections.filter((section) => section.key !== 'situation')} /></Panel>
              {readiness.eligibilityWaived ? (
                <p className="m-0 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-app-text" role="note">
                  The Admissions Office opened this application for you, so the qualification rules do not block it. Complete the remaining steps and submit.
                </p>
              ) : null}
              {eligibilityBlockers.length || profileBlockers.length ? (
                <ul className="m-0 grid gap-1 pl-5 text-sm text-rose-700 dark:text-rose-300" role="status">
                  {[...profileBlockers, ...eligibilityBlockers].map((blocker) => <li key={blocker}>{blocker.replace('Eligibility: ', '')}</li>)}
                </ul>
              ) : null}
              <div><Button type="button" onClick={() => { if (!isStatementDirty || window.confirm('Leave without saving your statement?')) onOpenProfile(); }}>Edit your Application Form</Button></div>
            </section>
          )}

          {current === 'financial' && (
            <>
              <StepIntro index={2} />
              {financialLoaded
                ? <ApplicationFinancialStep answers={financialAnswers} onChange={(next) => { setFinancialAnswers(next); setFinancialMessage(''); }} />
                : <SkeletonRegion label="Loading your financial answers" className="grid gap-4"><SkeletonText lines={2} /><SkeletonRows rows={3} /></SkeletonRegion>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={saveFinancial} disabled={!financialLoaded || !isFinancialDirty}>Save draft</Button>
                {financialLoaded && financialMissing.length ? <span className="text-sm text-app-muted" role="status">Still needed: {financialMissing.join('; ')}.</span> : null}
                {financialMessage ? <span className="text-sm text-app-muted" role="status">{financialMessage}</span> : null}
              </div>
            </>
          )}

          {current === 'statement' && (
            <section className="grid gap-3" aria-label="Application statement">
              <StepIntro index={3} />
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">
                  Statement/essay
                  {!statement.trim() && <RequiredMark />}
                </span>
                <span className="text-sm text-app-muted">{ESSAY_TOPIC}</span>
                <small className="field-hint">{ESSAY_INSTRUCTION}</small>
                <textarea
                  rows={9}
                  maxLength={ESSAY_MAX_LENGTH}
                  value={statement}
                  onChange={(event) => { setStatement(event.target.value); setStatementMessage(''); }}
              placeholder="Describe your circumstances, goals, and how this scholarship helps."
                />
                <div className="h-1.5 overflow-hidden rounded-full bg-app-border" aria-hidden="true">
                  <div className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${wordCount >= ESSAY_TARGET_WORDS ? 'bg-emerald-500' : 'bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright'}`} style={{ width: `${Math.min(100, Math.round((wordCount / ESSAY_TARGET_WORDS) * 100))}%` }} />
                </div>
                <small className="field-hint">Starts from your default statement/essay. Changes apply to this application unless you save them as your default. {wordCount} of about {ESSAY_TARGET_WORDS} words · {statement.length}/{ESSAY_MAX_LENGTH} characters</small>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={saveStatement} disabled={statement === (application.statement || '')}>Save draft</Button>
                <Button type="button" variant="ghost" onClick={applyDefaultStatement} disabled={!defaultStatement || statement === defaultStatement}>Use my default statement/essay</Button>
                <Button type="button" variant="ghost" onClick={saveAsDefault} disabled={!statement.trim() || statement.trim() === defaultStatement.trim()}>Save as my default</Button>
                {statementMessage ? <span className="text-sm text-app-muted" role="status">{statementMessage}</span> : null}
              </div>
            </section>
          )}

          {current === 'review' && (
            <section className="grid gap-3" aria-label="Review and submit">
              <StepIntro index={4}>{STEPS[4].intro}</StepIntro>
              <ul className="m-0 grid list-none gap-2 p-0">
                {[
                  { key: 'documents', label: 'Required documents', ok: documentsDone, value: `${coveredDocumentCount} of ${readiness.requiredCount} attached`, step: 0 },
                  { key: 'profile', label: 'Application form', ok: stepDone.profile, value: eligibilityBlockers.length ? 'Does not meet the current qualification rules' : profileBlockers.length ? 'Some answers are still missing' : readiness.eligibilityWaived ? 'Opened for you by the Admissions Office' : 'Meets the current qualification rules', step: PROFILE_STEP_INDEX },
                  { key: 'financial', label: 'Financial situation', ok: stepDone.financial, value: financialMissing.length ? 'Not complete yet' : 'Answered', step: 2 },
                  { key: 'statement', label: 'Statement', ok: stepDone.statement, value: statement.trim() ? `${wordCount} words` : 'Not written yet', step: 3 },
                ].map((item) => (
                  <li key={item.key} className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 ${item.ok ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-amber-400/50 bg-amber-500/10'}`}>
                    <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${item.ok ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'}`}>
                      {item.ok ? <Check size={14} strokeWidth={3} /> : <AlertCircle size={14} />}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5 text-sm">
                      <strong className="text-app-text">{item.label}</strong>
                      <span className="text-xs text-app-muted [overflow-wrap:anywhere]">{item.value}</span>
                    </span>
                    <Button type="button" variant="ghost" className="!min-h-9 shrink-0 !px-3 !py-1 !text-xs" onClick={() => setStep(item.step)}>{item.ok ? 'Edit' : 'Fix'}</Button>
                  </li>
                ))}
                <li className="px-3 text-xs text-app-muted">Supporting documents: {supportingCount} attached (optional)</li>
              </ul>
              {readiness.blockers.filter((blocker) => !blocker.startsWith('Certify')).length ? (
                <div className="grid gap-1 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
                  <strong className="text-sm text-app-text">Before you can submit</strong>
                  <ul className="m-0 grid gap-1 pl-5 text-sm text-app-muted">
                    {readiness.blockers.filter((blocker) => !blocker.startsWith('Certify')).map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="grid gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3" role="note" aria-label="What you are sharing">
                <strong className="flex items-center gap-2 text-sm text-app-text"><ShieldCheck size={16} aria-hidden="true" className="shrink-0 text-blue-600 dark:text-blue-300" />What you are sharing</strong>
                <p className="m-0 text-sm text-app-muted">
                  {sharedDocumentCount} attached {sharedDocumentCount === 1 ? 'document' : 'documents'}, your statement, and your full Application Form, including your personal, address, and family details, are shared with the Admissions Office and your Department Chair for this application. Your household finances and financial situation answers are shared with the Admissions Office only.
                </p>
                <div><Button type="button" variant="ghost" className="!min-h-10 !px-3 !py-1 !text-xs" onClick={() => setStep(PROFILE_STEP_INDEX)}>Review your application form</Button></div>
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface text-sm text-app-muted">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={noticeOpen}
                  aria-controls="agreement-notice"
                  onClick={() => setNoticeOpen((value) => !value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setNoticeOpen((value) => !value);
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl p-3 font-semibold text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
                >
                  Agreement and data privacy notice
                  <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-app-muted transition-transform duration-300 motion-reduce:transition-none ${noticeOpen ? 'rotate-180' : ''}`} />
                </div>
                <Collapse open={noticeOpen} id="agreement-notice">
                  <div className="px-3 pb-3">
                    <ol className="mt-0 grid gap-2 pl-5">{AFFIDAVIT_CLAUSES.map((clause) => <li key={clause}>{clause}</li>)}</ol>
                    <p className="mb-0 mt-3">{DATA_PRIVACY_NOTICE}</p>
                    {onOpenPrivacyDocument ? (
                      <div className="mt-2">
                        <Button type="button" variant="ghost" className="!min-h-10 !px-3 !py-1 !text-xs" onClick={() => onOpenPrivacyDocument('privacy')}>
                          Read the full Privacy Policy
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Collapse>
              </div>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm text-app-text transition-colors ${certified ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-app-border bg-app-surface'}`}>
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={certified} onChange={(event) => setCertified(event.target.checked)} />
                <span>{CERTIFICATION_TEXT}</span>
              </label>
            </section>
          )}
          </div>
        </div>

        {/* Pinned under the scrolling body: Back on the left, and the forward
            action (Next, or Submit on the last step) always at the bottom right. */}
        <div className="mt-3 grid gap-2 border-t border-app-border/60 pt-3">
          {submitError ? <p className="form-error m-0 text-right" role="alert">{submitError}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {step === STEPS.length - 1 ? (
                <>
                  <span className="max-w-xs text-right text-xs text-app-muted max-sm:hidden">After you submit, the application and its attached files are locked for review.</span>
                  <Button variant="primary" type="button" disabled={!readiness.ready || isSubmitting} onClick={handleSubmit}>{isSubmitting ? 'Submitting…' : 'Submit application'}</Button>
                </>
              ) : (
                <Button type="button" variant="primary" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}>Next: {STEPS[step + 1].label}<ArrowRight size={16} aria-hidden="true" /></Button>
              )}
            </div>
          </div>
          {step === STEPS.length - 1 ? <span className="text-xs text-app-muted sm:hidden">After you submit, the application and its attached files are locked for review.</span> : null}
        </div>
      </ModalShell>
      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}
