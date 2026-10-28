import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from './ui';
import { SelectPicker } from '../pages/LoginScreen';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import { isPhotoDocumentType } from '../lib/constants';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';
import { PHOTO_ACCEPT, PHOTO_MIME_TYPES } from '../lib/photoGuide';
import {
  buildDocumentPickerOptions,
  decodeDocumentSelection,
  encodeDocumentSelection,
  getAcceptedDocumentTypes,
  getDocumentSelectionForType,
  getDocumentTitle,
  getProvenAttributes,
  getVerifiableAttributeOption,
} from '../lib/profile';

// The Document Vault upload form, shared by the vault page and the upload dialog
// My Profile opens from "Attach proof" and the document checklist, so a student
// never leaves the Application Form to upload a proof.
//
// The form uses one grouped picker, mirroring the program/course picker in My
// Profile: each profile attribute is a group header with the document types it
// accepts listed below it, preceded by a "General documents" group for files that
// prove no profile answer. Selecting an item chooses the attribute and the
// document type together, and the vault derives the title from that pair, so
// there is no free-text title and no attribute checklist. The list follows the
// student's standing (buildDocumentPickerOptions).

// The preselected picker value: a preset document type when one is given (My
// Profile's document checklist), else the attribute's first accepted type for
// the standing, or nothing when the form opens without a preset. A preset type
// that proves an answer opens under its attribute, because a proving type is
// listed only there.
const initialSelection = (attributeKey = '', documentType = '', profile = null) => {
  if (documentType) {
    return attributeKey && getProvenAttributes(documentType, profile).includes(attributeKey)
      ? encodeDocumentSelection(attributeKey, documentType)
      : getDocumentSelectionForType(documentType, profile);
  }
  if (attributeKey) return encodeDocumentSelection(attributeKey, getAcceptedDocumentTypes(attributeKey, profile)[0]?.value || '');
  // No default type: a silent first option labelled every file uploaded without
  // touching the picker (and every upload after a reset) as that type.
  return '';
};

export default function DocumentUploadForm({ profile = null, onUpload, onUploaded, presetAttribute = '', presetDocumentType = '' }) {
  const [selection, setSelection] = useState(() => initialSelection(presetAttribute, presetDocumentType, profile));
  const standingKey = profile?.yearStanding || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const documentPickerOptions = useMemo(() => buildDocumentPickerOptions(profile), [standingKey]);
  const [formError, setFormError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  // The chosen file is held in state (not read from the form on submit) so a
  // camera capture can satisfy the upload just like a file-picker choice.
  const [file, setFile] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef(null);
  const { attributeKey, documentType } = decodeDocumentSelection(selection);
  const isPhoto = isPhotoDocumentType(documentType);
  const derivedTitle = getDocumentTitle({ attributeKey, documentType });
  // Every answer this upload will prove, the picked one and any other its type
  // proves (a grade report proves the QPI and academic standing together).
  const provesOnUpload = [...new Set([...(attributeKey ? [attributeKey] : []), ...getProvenAttributes(documentType, profile)])];

  // Opening the vault from My Profile's "Attach proof" or document checklist
  // link preselects the attribute and document type so the upload is one step.
  useEffect(() => {
    if (!presetAttribute && !presetDocumentType) return;
    setSelection(initialSelection(presetAttribute, presetDocumentType, profile));
    // The preset is applied once per navigation; a profile edit does not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetAttribute, presetDocumentType]);

  const resetPickedFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Switching the picker clears the chosen file: a PDF picked for one type is
  // not a valid photo for another.
  const handleSelection = (value) => {
    setSelection(value);
    setFormError('');
    resetPickedFile();
  };

  const handleFileChange = (event) => {
    const picked = event.target.files?.[0] || null;
    setFormError('');
    if (!picked) { setFile(null); return; }
    if (picked.size > DOCUMENT_MAX_BYTES) { setFile(null); setFormError('Files must be 10 MB or smaller.'); return; }
    if (isPhoto && !PHOTO_MIME_TYPES.includes(picked.type)) {
      setFile(null);
      setFormError('Choose a JPG or PNG photo, or take one with the camera.');
      return;
    }
    setFile(picked);
  };

  // The capture modal already normalizes (square for an ID photo, native aspect
  // for residence photos) and returns a JPEG File.
  const useCameraPhoto = (photo) => {
    setFile(photo);
    setFormError('');
    return { ok: true };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!documentType || !file) { setFormError('Choose a document type and a file.'); return; }
    if (file.size > DOCUMENT_MAX_BYTES) { setFormError('Files must be 10 MB or smaller.'); return; }
    setFormError('');
    setIsUploading(true);
    let result;
    try {
      result = await onUpload({ file, documentType, attributeKey });
    } catch {
      setFormError('The document could not be uploaded.');
      return;
    } finally {
      setIsUploading(false);
    }
    if (result?.error) { setFormError(result.error); return; }
    resetPickedFile();
    setSelection(initialSelection('', '', profile));
    onUploaded?.(result);
  };

  return (
    <>
      <form className="vault-upload-form grid gap-3" onSubmit={handleSubmit}>
        <SelectPicker
          label="Document type"
          value={selection}
          onChange={handleSelection}
          options={documentPickerOptions}
          idPrefix="vault-document-type"
          placeholder="Choose a document type"
          required
        />
        <small className="field-hint -mt-1">
          {!documentType
            ? 'Choose what this file is before uploading it.'
            : provesOnUpload.length
              ? `Proves your ${provesOnUpload.map((key) => getVerifiableAttributeOption(key)?.label || key).join(' and ')} as it reads in your Application Form now.`
              : 'A general document proves no profile answer.'}
        </small>
        {isPhoto ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => setCameraOpen(true)} disabled={isUploading}>
                <Camera size={16} aria-hidden="true" /> Take photo
              </Button>
              <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-app-border bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20 ${isUploading ? 'pointer-events-none opacity-60' : ''}`}>
                Upload an existing photo
                <input ref={fileInputRef} type="file" accept={PHOTO_ACCEPT} className="sr-only" onChange={handleFileChange} disabled={isUploading} />
              </label>
              {file ? <span className="min-w-0 text-xs text-app-muted">Selected: <strong className="[overflow-wrap:anywhere]">{file.name}</strong></span> : null}
            </div>
            <small className="field-hint">
              JPG or PNG, up to 10 MB.
              {documentType === 'Photos of Residence' ? ' Upload one file at a time to attach several photos.' : ''}
            </small>
            <PhotoGuide documentType={documentType} defaultOpen />
          </div>
        ) : (
          <label>
            <span>File</span>
            <input ref={fileInputRef} type="file" accept={DOCUMENT_ACCEPT} onChange={handleFileChange} disabled={isUploading} />
            <small className="field-hint">PDF, JPG, or PNG | up to 10 MB</small>
          </label>
        )}
        <p className="field-hint m-0">The Admissions Office and your Department Chair can view these files to verify them.</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {documentType ? <p className="field-hint m-0">Saved as <strong>{derivedTitle}</strong></p> : null}
          <button className="vault-upload-button inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isUploading}>{isUploading ? 'Uploading…' : 'Upload to vault'}</button>
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </form>
      {cameraOpen ? (
        <PhotoCaptureModal
          title={documentType === 'Photos of Residence' ? 'Take a photo of your residence' : 'Take your 2x2 ID photo'}
          documentType={documentType}
          onUsePhoto={useCameraPhoto}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </>
  );
}
