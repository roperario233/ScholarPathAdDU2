import { useMemo, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal from './DocumentPreviewModal';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import ApplicationFinancialStep from './ApplicationFinancialStep';
import ApplicationPrintButton from './ApplicationPrintSheet';
import { DocumentRejectionReason, ProfileSnapshotList, RequirementStateBadge } from './ApplicationParts';
import { buildProfileSnapshot, describeRequirementTypes, getApplicantPhotoDocument, getApplicationAttributeVerifications, getApplicationReadiness, getMatchingVaultDocuments } from '../lib/applicationRequirements';
import { getDocumentStatusLabel, getDocumentTypeLabel, isPhotoDocumentType } from '../lib/constants';
import { AFFIDAVIT_CLAUSES, DATA_PRIVACY_NOTICE, ESSAY_INSTRUCTION, ESSAY_TARGET_WORDS, ESSAY_TOPIC, countWords } from '../lib/applicationForm';
import { getFinancialAnswersMissing, getFinancialDetailSections, normalizeFinancialAnswers } from '../lib/financialDetails';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';
import { PHOTO_ACCEPT, photoRequirementNeedsCamera } from '../lib/photoGuide';
import { ESSAY_MAX_LENGTH, getVerifiableAttributeOption } from '../lib/profile';
import { fmtDate } from '../lib/formatters';

const STEPS = [
  { key: 'documents', label: 'Required documents' },
  { key: 'profile', label: 'Profile snapshot' },
  { key: 'financial', label: 'Financial situation' },
  { key: 'statement', label: 'Statement' },
  { key: 'review', label: 'Review and submit' },
];

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

  return (
    <li className="grid gap-3 rounded-2xl border border-app-border bg-app-surface p-4">
      <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between">
        <div className="min-w-0 w-full flex-1">
          <h4 className="m-0 text-sm font-bold text-app-text">{requirement.label}</h4>
          <p className="m-0 mt-1 text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)} · any one is enough</p>
          {requirement.proves?.length ? (
            <p className="m-0 mt-1 text-xs text-app-muted">
              Proves your {requirement.proves.map((key) => getVerifiableAttributeOption(key)?.label || key).join(' and ')} as declared in My Profile
            </p>
          ) : null}
          {requirement.note ? <p className="m-0 mt-1 text-xs text-app-muted">{requirement.note}</p> : null}
        </div>
        <RequirementStateBadge state={requirement.state} />
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
    </li>
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
  onAttach,
  onDetach,
  onUploadAndAttach,
  onSaveDraft,
  onSubmit,
  onSaveProfile,
  onOpenProfile,
  onClose,
}) {
  const [step, setStep] = useState(0);
  // A draft started before statements existed falls back to the profile essay.
  const [savedStatement, setSavedStatement] = useState(() => application.statement || profile?.essay || '');
  const [statement, setStatement] = useState(savedStatement);
  // The per-application financial situation answers (office-only). Saved with
  // the draft in application_financial_details.
  const [savedFinancial, setSavedFinancial] = useState(() => normalizeFinancialAnswers(savedFinancialAnswers || {}));
  const [financialAnswers, setFinancialAnswers] = useState(savedFinancial);
  const [financialMessage, setFinancialMessage] = useState('');
  const [certified, setCertified] = useState(false);
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
    () => getFinancialDetailSections({ financialProfile: profile?.financialProfile, answers: financialAnswers, family: profile?.familyDetails || {} }),
    [profile, financialAnswers],
  );
  const wordCount = countWords(statement);
  const eligibilityBlockers = readiness.blockers.filter((blocker) => blocker.startsWith('Eligibility:'));
  const documentsDone = readiness.requirements.every((item) => item.state === 'attached' || item.state === 'verified');
  const profileBlockers = readiness.blockers.filter((blocker) => blocker.startsWith('Complete your profile') || blocker.startsWith('Set your year standing'));
  const supportingCount = readiness.supportingDocuments.length;

  const stepDone = {
    documents: documentsDone,
    profile: eligibilityBlockers.length === 0 && profileBlockers.length === 0,
    financial: financialMissing.length === 0,
    statement: Boolean(statement.trim()),
    review: readiness.ready,
  };

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

  // The profile's default statement is a reusable template: it can replace this
  // draft's text, or this text can become the default for future applications.
  const defaultStatement = String(profile?.essay || '');

  const applyDefaultStatement = () => {
    if (statement.trim() && !window.confirm('Replace this statement with your default scholarship statement from My Profile?')) return;
    setStatement(defaultStatement);
    setStatementMessage('');
  };

  const saveAsDefault = async () => {
    setStatementMessage('');
    const result = await onSaveProfile({ essay: statement.trim() });
    setStatementMessage(result?.success ? 'Saved as your default scholarship statement.' : result?.message || 'Unable to save your default statement.');
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
    onClose();
  };

  const current = STEPS[step].key;

  return (
    <>
      <ModalShell title={application.scholarshipTitle} onClose={handleClose} className="application-detail-modal !w-[min(1080px,100%)] !max-h-[min(92vh,920px)] max-sm:!max-h-[calc(100dvh-1.5rem)]">
        <div className="application-detail-modal-body grid content-start gap-4">
          <p className="m-0 text-sm text-app-muted">
            Application workspace · Deadline {fmtDate(scholarship?.deadline)} · {readiness.attachedCount} of {readiness.requiredCount} required documents attached
          </p>

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
                    <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.7rem] ${done ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-app-muted-surface text-app-muted'}`}>{done ? '✓' : index + 1}</span>
                    <span className="min-w-0">{entry.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {current === 'documents' && (
            <section className="grid gap-3" aria-label="Required documents">
              <p className="m-0 text-sm text-app-muted">Attach one file per requirement. Uploads go to your Document Vault and can be reused.</p>
              {readiness.requirements.length ? (
                <ul className="m-0 grid gap-3 p-0">
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
            <section className="grid gap-3" aria-label="Profile snapshot">
              <p className="m-0 text-sm text-app-muted">Frozen on submit. The Admissions Office and your Department Chair see the profile values; the household finances and financial situation go to the Admissions Office only.</p>
              <Panel><ProfileSnapshotList snapshot={snapshot} expanded applicantPhoto={getApplicantPhotoDocument(application, documents)} onPreviewPhoto={setPreview} extraSections={financialSections} /></Panel>
              {eligibilityBlockers.length || profileBlockers.length ? (
                <ul className="m-0 grid gap-1 pl-5 text-sm text-rose-700 dark:text-rose-300" role="status">
                  {[...profileBlockers, ...eligibilityBlockers].map((blocker) => <li key={blocker}>{blocker.replace('Eligibility: ', '')}</li>)}
                </ul>
              ) : null}
              <div><Button type="button" onClick={() => { if (!isStatementDirty || window.confirm('Leave without saving your statement?')) onOpenProfile(); }}>Edit in My Profile</Button></div>
            </section>
          )}

          {current === 'financial' && (
            <>
              <ApplicationFinancialStep answers={financialAnswers} onChange={(next) => { setFinancialAnswers(next); setFinancialMessage(''); }} missing={financialMissing} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={saveFinancial} disabled={!isFinancialDirty}>Save draft</Button>
                {financialMessage ? <span className="text-sm text-app-muted" role="status">{financialMessage}</span> : null}
              </div>
            </>
          )}

          {current === 'statement' && (
            <section className="grid gap-3" aria-label="Application statement">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Scholarship essay</span>
                <span className="text-sm text-app-muted">{ESSAY_TOPIC}</span>
                <small className="field-hint">{ESSAY_INSTRUCTION}</small>
                <textarea
                  rows={9}
                  maxLength={ESSAY_MAX_LENGTH}
                  value={statement}
                  onChange={(event) => { setStatement(event.target.value); setStatementMessage(''); }}
              placeholder="Describe your circumstances, goals, and how this scholarship helps."
                />
                <small className="field-hint">Starts from your default statement. Changes apply to this application unless you save them as your default. {wordCount} of about {ESSAY_TARGET_WORDS} words · {statement.length}/{ESSAY_MAX_LENGTH} characters</small>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={saveStatement} disabled={statement === (application.statement || '')}>Save draft</Button>
                <Button type="button" variant="ghost" onClick={applyDefaultStatement} disabled={!defaultStatement || statement === defaultStatement}>Use my default statement</Button>
                <Button type="button" variant="ghost" onClick={saveAsDefault} disabled={!statement.trim() || statement.trim() === defaultStatement.trim()}>Save as my default</Button>
                {statementMessage ? <span className="text-sm text-app-muted" role="status">{statementMessage}</span> : null}
              </div>
            </section>
          )}

          {current === 'review' && (
            <section className="grid gap-3" aria-label="Review and submit">
              <Panel className="grid gap-1 text-sm text-app-muted">
                <span><strong className="text-app-text">Documents</strong> {readiness.attachedCount} of {readiness.requiredCount} attached</span>
                <span><strong className="text-app-text">Supporting documents</strong> {supportingCount} attached (optional)</span>
                <span><strong className="text-app-text">Financial situation</strong> {financialMissing.length ? 'Not complete yet' : 'Answered'}</span>
                <span><strong className="text-app-text">Statement</strong> {statement.trim() ? `${wordCount} words` : 'Not written yet'}</span>
                <span><strong className="text-app-text">Profile</strong> {eligibilityBlockers.length ? 'Does not meet the current qualification rules' : 'Meets the current qualification rules'}</span>
              </Panel>
              {readiness.blockers.filter((blocker) => !blocker.startsWith('Certify')).length ? (
                <div className="grid gap-1 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
                  <strong className="text-sm text-app-text">Before you can submit</strong>
                  <ul className="m-0 grid gap-1 pl-5 text-sm text-app-muted">
                    {readiness.blockers.filter((blocker) => !blocker.startsWith('Certify')).map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="grid gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3" role="note" aria-label="What you are sharing">
                <strong className="text-sm text-app-text">What you are sharing</strong>
                <p className="m-0 text-sm text-app-muted">
                  Your required documents, {supportingCount} supporting {supportingCount === 1 ? 'document' : 'documents'}, your statement, and your full profile snapshot, including your personal, address, and family details, are shared with the Admissions Office and your Department Chair for this application. Your household finances and financial situation answers are shared with the Admissions Office only.
                </p>
                <div><Button type="button" variant="ghost" className="!min-h-10 !px-3 !py-1 !text-xs" onClick={() => setStep(PROFILE_STEP_INDEX)}>Review your profile snapshot</Button></div>
              </div>
              <Panel className="grid gap-2 text-sm text-app-muted">
                <strong className="text-app-text">Two pages stay on paper</strong>
                <p className="m-0">Print the application form, have the Punong Barangay certify the residence photos, and have yourself and both parents sign the affidavit. Upload the signed pages in the Required documents step.</p>
                <div><ApplicationPrintButton sheet={{ application, snapshot, financialSections, statement, requirements: readiness.requirements, applicantPhoto: getApplicantPhotoDocument(application, documents) }} /></div>
              </Panel>
              <details className="rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-muted">
                <summary className="cursor-pointer font-semibold text-app-text">Affidavit of agreement and data privacy notice</summary>
                <ol className="mt-2 grid gap-2 pl-5">{AFFIDAVIT_CLAUSES.map((clause) => <li key={clause}>{clause}</li>)}</ol>
                <p className="mb-0 mt-3">{DATA_PRIVACY_NOTICE}</p>
              </details>
              <label className="flex items-start gap-3 rounded-xl border border-app-border bg-app-surface p-3 text-sm text-app-text">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={certified} onChange={(event) => setCertified(event.target.checked)} />
                <span>{CERTIFICATION_TEXT}</span>
              </label>
              {submitError ? <p className="form-error m-0" role="alert">{submitError}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" type="button" disabled={!readiness.ready || isSubmitting} onClick={handleSubmit}>{isSubmitting ? 'Submitting…' : 'Submit application'}</Button>
                <span className="text-xs text-app-muted">After you submit, the application and its attached files are locked for review.</span>
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border/60 pt-3">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
            {step < STEPS.length - 1 ? <Button type="button" variant="primary" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}>Next: {STEPS[step + 1].label}</Button> : null}
          </div>
        </div>
      </ModalShell>
      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}
