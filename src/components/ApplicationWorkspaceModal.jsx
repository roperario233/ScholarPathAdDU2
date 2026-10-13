import { useMemo, useState } from 'react';
import { Button, ModalShell, Panel, StatusBadge } from './ui';
import DocumentPreviewModal from './DocumentPreviewModal';
import { ProfileSnapshotList, RequirementStateBadge } from './ApplicationParts';
import { buildProfileSnapshot, describeRequirementTypes, getApplicationReadiness, getMatchingVaultDocuments } from '../lib/applicationRequirements';
import { getDocumentTypeLabel } from '../lib/constants';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';
import { ESSAY_MAX_LENGTH } from '../lib/profile';
import { fmtDate } from '../lib/formatters';

const STEPS = [
  { key: 'documents', label: 'Required documents' },
  { key: 'profile', label: 'Profile snapshot' },
  { key: 'statement', label: 'Statement' },
  { key: 'review', label: 'Review and submit' },
];

const PROFILE_STEP_INDEX = STEPS.findIndex((entry) => entry.key === 'profile');

// The certification doubles as the student's consent to share the application
// with the reviewers who handle it.
const CERTIFICATION_TEXT = 'I certify that the information and documents I provided are true and complete, and I agree to share them with the Admissions Office and my Department Chair for this application.';

// One required document: what it accepts, what is attached, and the two ways to
// satisfy it — reuse a Document Vault file or upload a new one into the vault.
function RequirementRow({ requirement, documents, attachedIds, busy, error, onAttach, onDetach, onUpload, onPreview }) {
  const [uploadType, setUploadType] = useState(requirement.documentTypes[0]);
  const reusable = getMatchingVaultDocuments(requirement, documents).filter((doc) => !attachedIds.includes(doc.id));

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(requirement, { file, documentType: uploadType });
  };

  return (
    <li className="grid gap-3 rounded-2xl border border-app-border bg-app-surface p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-bold text-app-text">{requirement.label}</h4>
          <p className="m-0 mt-1 text-xs text-app-muted">Accepts {describeRequirementTypes(requirement)}</p>
        </div>
        <RequirementStateBadge state={requirement.state} />
      </div>

      {requirement.attached.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {requirement.attached.map((doc) => (
            <li key={doc.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border/70 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-app-text">{doc.title} <span className="text-xs text-app-muted">· {doc.fileName}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{doc.verificationStatus}</StatusBadge>
                <Button type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onPreview(doc)}>View</Button>
                <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 !text-xs" disabled={busy} onClick={() => onDetach(requirement, doc.id)}>Remove</Button>
              </span>
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
                {doc.title} · {doc.verificationStatus} · {fmtDate(doc.uploadedAt)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>{requirement.state === 'rejected' ? 'Upload a replacement' : 'Or upload a new file'}</span>
          <div className="flex min-w-0 flex-wrap gap-2">
            {requirement.documentTypes.length > 1 ? (
              <select className="min-w-0 flex-1" value={uploadType} onChange={(event) => setUploadType(event.target.value)} aria-label={`Document type for ${requirement.label}`} disabled={busy}>
                {requirement.documentTypes.map((type) => <option key={type} value={type}>{getDocumentTypeLabel(type)}</option>)}
              </select>
            ) : null}
            <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-blue-500/35 bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy ? 'Working…' : 'Upload file'}
              <input type="file" accept={DOCUMENT_ACCEPT} className="sr-only" onChange={handleFile} disabled={busy} />
            </label>
          </div>
        </div>
      </div>
      {error ? <p className="form-error m-0" role="alert">{error}</p> : null}
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
  const optionFor = (doc) => <option key={doc.id} value={doc.id}>{doc.title} · {doc.verificationStatus} · {fmtDate(doc.uploadedAt)}</option>;

  return (
    <section className="grid gap-3 rounded-2xl border border-dashed border-app-border bg-app-surface/60 p-4" aria-label="Additional supporting documents">
      <div className="grid gap-1">
        <h4 className="m-0 text-sm font-bold text-app-text">Additional supporting documents (optional)</h4>
        <p className="m-0 text-xs text-app-muted">Add other Document Vault files that support your application, such as proof of your profile answers. They are sent with your application but are not required to submit. To add a new file, upload it in the Document Vault first.</p>
      </div>
      {readiness.supportingDocuments.length ? (
        <ul className="m-0 grid gap-2 p-0">
          {readiness.supportingDocuments.map((doc) => (
            <li key={doc.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border/70 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-app-text">{doc.title} <span className="text-xs text-app-muted">· {doc.fileName}</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{doc.verificationStatus}</StatusBadge>
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
  attributeVerifications,
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
    certified,
  }), [application, statement, scholarship, documents, profile, certified]);
  const snapshot = useMemo(() => buildProfileSnapshot(profile, attributeVerifications), [profile, attributeVerifications]);
  const isStatementDirty = statement !== savedStatement;
  const eligibilityBlockers = readiness.blockers.filter((blocker) => blocker.startsWith('Eligibility:'));
  const documentsDone = readiness.requirements.every((item) => item.state === 'attached' || item.state === 'verified');
  const supportingCount = readiness.supportingDocuments.length;

  const stepDone = {
    documents: documentsDone,
    profile: eligibilityBlockers.length === 0,
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
    if (isStatementDirty && !window.confirm('Discard the unsaved changes to your statement?')) return;
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitError('');
    setIsSubmitting(true);
    const result = await onSubmit(application.id, { statement, certified });
    setIsSubmitting(false);
    if (result?.error) { setSubmitError(result.error); return; }
    onClose();
  };

  const current = STEPS[step].key;

  return (
    <>
      <ModalShell title={application.scholarshipTitle} onClose={handleClose} className="application-detail-modal !w-[min(880px,100%)] !max-h-[min(90vh,860px)]">
        <div className="application-detail-modal-body grid content-start gap-4">
          <p className="m-0 text-sm text-app-muted">
            Application workspace · Deadline {fmtDate(scholarship?.deadline)} · {readiness.attachedCount} of {readiness.requiredCount} required documents attached
          </p>

          <ol className="m-0 grid grid-cols-2 gap-2 p-0 sm:grid-cols-4" aria-label="Application steps">
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
              <p className="m-0 text-sm text-app-muted">Attach one file for each requirement. Files you upload here are saved to your Document Vault so you can reuse them for other applications. A file pending review is enough to submit; the Admissions Office verifies it during document verification.</p>
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
              <p className="m-0 text-sm text-app-muted">Everything listed here is sent with your application and frozen when you submit. The Admissions Office and your Department Chair see the same values. Update them in My Profile if anything has changed.</p>
              <Panel><ProfileSnapshotList snapshot={snapshot} expanded /></Panel>
              {eligibilityBlockers.length ? (
                <ul className="m-0 grid gap-1 pl-5 text-sm text-rose-700 dark:text-rose-300" role="status">
                  {eligibilityBlockers.map((blocker) => <li key={blocker}>{blocker.replace('Eligibility: ', '')}</li>)}
                </ul>
              ) : null}
              <div><Button type="button" onClick={() => { if (!isStatementDirty || window.confirm('Leave without saving your statement?')) onOpenProfile(); }}>Edit in My Profile</Button></div>
            </section>
          )}

          {current === 'statement' && (
            <section className="grid gap-3" aria-label="Application statement">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Why are you applying for this scholarship?</span>
                <textarea
                  rows={9}
                  maxLength={ESSAY_MAX_LENGTH}
                  value={statement}
                  onChange={(event) => { setStatement(event.target.value); setStatementMessage(''); }}
                  placeholder="Describe your circumstances, goals, and how this scholarship would support your studies."
                />
                <small className="field-hint">Starts from the default scholarship statement in My Profile. Changes here apply only to this application unless you save them as your default. {statement.length}/{ESSAY_MAX_LENGTH}</small>
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
                <span><strong className="text-app-text">Statement</strong> {statement.trim() ? `${statement.trim().length} characters` : 'Not written yet'}</span>
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
                  Your required documents, {supportingCount} supporting {supportingCount === 1 ? 'document' : 'documents'}, your statement, and your full profile snapshot, including your personal, address, and family details, are shared with the Admissions Office and your Department Chair for this application.
                </p>
                <div><Button type="button" variant="ghost" className="!min-h-10 !px-3 !py-1 !text-xs" onClick={() => setStep(PROFILE_STEP_INDEX)}>Review your profile snapshot</Button></div>
              </div>
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
