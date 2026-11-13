import { useMemo, useState } from 'react';
import ReasonModal from './ReasonModal';
import { SelectPicker } from '../pages/LoginScreen';
import { documentTypeOptions, getDocumentTypeLabel } from '../lib/constants';
import {
  DOCUMENT_REQUEST_KINDS,
  DOCUMENT_REQUEST_LABEL_MAX,
  DOCUMENT_REQUEST_MAX_FILES,
  DOCUMENT_REQUEST_NOTE_MAX,
  getRequestableRequirements,
  suggestRequestLabel,
  validateDocumentRequest,
} from '../lib/documentRequests';

// The Admissions Office Admin asks the student for more documents while the
// application is at document verification: more files for a required document
// (extra residence photos), one document the scholarship did not list, or
// something described in words. The note is shown to the student, so the dialog
// says so. The application keeps its stage; an open request holds it at
// verification until the student answers or the Admin cancels it.
export default function RequestDocumentsModal({
  requirements = [],
  initialKind = '',
  initialRequirementId = '',
  onConfirm,
  onClose,
}) {
  const requestable = useMemo(() => getRequestableRequirements(requirements), [requirements]);
  const startKind = initialKind || (requestable.length ? 'more_files' : 'new_document');
  const [kind, setKind] = useState(startKind);
  const [requirementId, setRequirementId] = useState(initialRequirementId || '');
  const [documentType, setDocumentType] = useState('');
  const [minFiles, setMinFiles] = useState(1);
  const [label, setLabel] = useState(() => suggestRequestLabel({ kind: startKind, requirementId: initialRequirementId }, { requirements }));
  const [labelTouched, setLabelTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const draft = { kind, requirementId, documentType, label, minFiles };
  const documentTypePickerOptions = useMemo(
    () => documentTypeOptions.map((option) => ({ value: option.value, label: option.label })),
    [],
  );

  // Keeps the proposed name in step with what is being asked for, until the Admin
  // edits the name themselves.
  const update = (patch) => {
    const next = { ...draft, ...patch };
    if (!labelTouched && (patch.kind !== undefined || patch.requirementId !== undefined || patch.documentType !== undefined)) {
      setLabel(suggestRequestLabel(next, { requirements }));
    }
    if (patch.kind !== undefined) setKind(patch.kind);
    if (patch.requirementId !== undefined) setRequirementId(patch.requirementId);
    if (patch.documentType !== undefined) setDocumentType(patch.documentType);
    if (patch.minFiles !== undefined) setMinFiles(patch.minFiles);
    setFieldErrors({});
  };

  const handleConfirm = (note) => {
    const checked = validateDocumentRequest({ ...draft, note }, { requirements });
    setFieldErrors(checked.errors);
    if (!checked.ok) {
      return Promise.resolve({ error: Object.values(checked.errors)[0] });
    }
    return Promise.resolve(onConfirm(checked.value)).then((result) => {
      if (!result?.error) onClose();
      return result;
    });
  };

  const kindDescription = DOCUMENT_REQUEST_KINDS.find((entry) => entry.value === kind)?.description || '';

  return (
    <ReasonModal
      title="Request additional documents"
      label="What the student should provide"
      hint={`The student reads this note on their application (up to ${DOCUMENT_REQUEST_NOTE_MAX} characters), so keep it specific and free of anything confidential. For example: “Please add two more photos of the front and side of the house.”`}
      confirmLabel="Send request"
      confirmVariant="primary"
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      <p className="m-0 text-sm text-app-muted">
        The application stays at document verification. It cannot move on to interview until the student answers and you verify the new files, or you cancel the request.
      </p>

      <label className="grid gap-2 text-sm text-app-text">
        <span className="font-semibold">What kind of request is this?</span>
        <select value={kind} onChange={(event) => update({ kind: event.target.value })}>
          {DOCUMENT_REQUEST_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value} disabled={entry.value === 'more_files' && !requestable.length}>{entry.label}</option>
          ))}
        </select>
        {kindDescription ? <span className="text-xs text-app-muted">{kindDescription}</span> : null}
        {fieldErrors.kind ? <span className="text-sm text-rose-300" role="alert">{fieldErrors.kind}</span> : null}
      </label>

      {kind === 'more_files' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="grid content-start gap-2 text-sm text-app-text">
            <span className="font-semibold">Required document</span>
            <select value={requirementId} onChange={(event) => update({ requirementId: event.target.value })} aria-invalid={Boolean(fieldErrors.requirementId)}>
              <option value="">Choose a required document…</option>
              {requestable.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            {fieldErrors.requirementId ? <span className="text-sm text-rose-300" role="alert">{fieldErrors.requirementId}</span> : null}
          </label>
          <label className="grid content-start gap-2 text-sm text-app-text">
            <span className="font-semibold">How many more</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max={DOCUMENT_REQUEST_MAX_FILES}
              value={minFiles}
              onChange={(event) => update({ minFiles: event.target.value === '' ? '' : Number(event.target.value) })}
              aria-invalid={Boolean(fieldErrors.minFiles)}
            />
            {fieldErrors.minFiles ? <span className="text-sm text-rose-300" role="alert">{fieldErrors.minFiles}</span> : null}
          </label>
        </div>
      ) : null}

      {kind === 'new_document' ? (
        <SelectPicker
          label="Document type"
          idPrefix="request-document-type"
          value={documentType}
          options={documentTypePickerOptions}
          placeholder="Choose a document type"
          required
          error={fieldErrors.documentType || ''}
          onChange={(value) => update({ documentType: value })}
        />
      ) : null}

      <label className="grid gap-2 text-sm text-app-text">
        <span className="font-semibold">Name shown to the student</span>
        <input
          type="text"
          value={label}
          maxLength={DOCUMENT_REQUEST_LABEL_MAX}
          placeholder={kind === 'new_document' && documentType ? getDocumentTypeLabel(documentType) : 'For example: Additional photos of residence'}
          onChange={(event) => {
            setLabel(event.target.value);
            setLabelTouched(true);
            setFieldErrors((previous) => ({ ...previous, label: '' }));
          }}
          aria-invalid={Boolean(fieldErrors.label)}
        />
        {fieldErrors.label ? <span className="text-sm text-rose-300" role="alert">{fieldErrors.label}</span> : null}
      </label>
    </ReasonModal>
  );
}
