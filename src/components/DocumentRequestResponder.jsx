import { useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from './ui';
import PhotoCaptureModal from './PhotoCaptureModal';
import PhotoGuide from './PhotoGuide';
import { PHOTO_ACCEPT } from '../lib/photoGuide';
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES } from '../lib/documentStorage';
import { getDocumentStatusLabel, getDocumentTypeLabel, isPhotoDocumentType } from '../lib/constants';
import { describeDocumentRequest, getRequestUploadTypes, isRequestAnswerable } from '../lib/documentRequests';
import { fmtDate } from '../lib/formatters';

const pickerButton = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-blue-500/35 bg-app-card px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus-within:ring-4 focus-within:ring-blue-500/20';

// Lets a student answer an additional-documents request the Admissions Office
// raised while their application is at document verification. They stage vault
// files and/or new files (which land in the Document Vault first) until the
// request's minimum is met, then confirm once. Nothing is sent, and no file is
// attached, until the confirmation. `candidates` comes from
// getRequestFulfilmentOptions() in src/lib/documentRequests.js;
// `onFulfill(requestId, { documentIds, uploads })` resolves to `{ ok }` or `{ error }`.
export default function DocumentRequestResponder({ request, candidates = [], onFulfill }) {
  const description = describeDocumentRequest(request);
  const uploadTypes = getRequestUploadTypes(request);
  const [uploadType, setUploadType] = useState(uploadTypes[0]);
  const [staged, setStaged] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const photoType = isPhotoDocumentType(uploadType) ? uploadType : '';
  const needed = request.minFiles || 1;

  const stagedVaultIds = staged.filter((entry) => entry.documentId).map((entry) => entry.documentId);
  const availableCandidates = candidates.filter((candidate) => !stagedVaultIds.includes(candidate.id));
  const stagedCount = staged.length;
  const remaining = Math.max(0, needed - stagedCount);
  const answerable = isRequestAnswerable(request, stagedCount);

  const stageVaultFile = (event) => {
    const candidate = availableCandidates.find((entry) => entry.id === event.target.value);
    if (!candidate) return;
    setError('');
    setStaged((previous) => [...previous, {
      key: `vault-${candidate.id}`,
      documentId: candidate.id,
      name: candidate.title,
      detail: `From your Document Vault · ${getDocumentStatusLabel(candidate.verificationStatus)} · ${fmtDate(candidate.uploadedAt)}`,
    }]);
  };

  const stageNewFile = (file, documentType) => {
    setStaged((previous) => [...previous, {
      key: `new-${crypto.randomUUID()}`,
      file,
      documentType,
      name: file.name,
      detail: `New upload as ${getDocumentTypeLabel(documentType)} · ${Math.max(1, Math.round(file.size / 1024))} KB · saved to your Document Vault`,
    }]);
  };

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const tooLarge = files.find((file) => file.size > DOCUMENT_MAX_BYTES);
    if (tooLarge) {
      setError(`“${tooLarge.name}” is larger than 10 MB. Files must be 10 MB or smaller.`);
      return;
    }
    setError('');
    files.forEach((file) => stageNewFile(file, uploadType));
  };

  const useCameraPhoto = (file) => {
    setError('');
    stageNewFile(file, photoType);
    return { ok: true };
  };

  const removeStaged = (key) => setStaged((previous) => previous.filter((entry) => entry.key !== key));

  const confirm = async () => {
    if (!answerable || busy) return;
    setBusy(true);
    setError('');
    const result = await onFulfill(request.id, {
      documentIds: staged.filter((entry) => entry.documentId).map((entry) => entry.documentId),
      uploads: staged.filter((entry) => entry.file).map((entry) => ({ file: entry.file, documentType: entry.documentType })),
    });
    setBusy(false);
    if (result?.error) setError(result.error);
    else setStaged([]);
  };

  return (
    <div className="grid gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
      <div className="grid gap-1">
        <p className="m-0 text-sm font-semibold text-app-text [overflow-wrap:anywhere]">{description.title}</p>
        <p className="m-0 text-xs text-app-muted">{[description.summary, description.types].filter(Boolean).join(' · ')}</p>
        <p className="m-0 whitespace-pre-line text-sm text-app-text [overflow-wrap:anywhere]">
          <span className="font-semibold text-amber-800 dark:text-amber-200">From the Admissions Office: </span>
          {request.note}
        </p>
        <p className="m-0 text-xs text-app-muted">Your application keeps its current status. The files you add go to verification, and the office is told when you send them.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>Choose from your Document Vault</span>
          <select
            value=""
            disabled={busy || !availableCandidates.length}
            onChange={stageVaultFile}
            aria-label={`Choose a vault file for ${description.title}`}
          >
            <option value="">{availableCandidates.length ? 'Select a file…' : 'No other matching files in your vault'}</option>
            {availableCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.title} · {getDocumentStatusLabel(candidate.verificationStatus)} · {fmtDate(candidate.uploadedAt)}</option>
            ))}
          </select>
        </label>
        <div className="grid content-start gap-1 text-xs font-semibold text-app-muted">
          <span>Or add files from your device</span>
          <div className="flex min-w-0 flex-wrap gap-2">
            {uploadTypes.length > 1 ? (
              <select className="min-w-0 flex-1" value={uploadType} onChange={(event) => setUploadType(event.target.value)} aria-label={`Document type for ${description.title}`} disabled={busy}>
                {uploadTypes.map((type) => <option key={type} value={type}>{getDocumentTypeLabel(type)}</option>)}
              </select>
            ) : null}
            {photoType ? (
              <>
                <Button type="button" onClick={() => setCameraOpen(true)} disabled={busy}>
                  <Camera size={16} aria-hidden="true" /> Take photo
                </Button>
                <label className={`${pickerButton} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                  Choose photos
                  <input type="file" accept={PHOTO_ACCEPT} multiple className="sr-only" onChange={handleFiles} disabled={busy} />
                </label>
              </>
            ) : (
              <label className={`${pickerButton} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                Choose files
                <input type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" onChange={handleFiles} disabled={busy} />
              </label>
            )}
          </div>
        </div>
      </div>
      {photoType ? <PhotoGuide documentType={photoType} defaultOpen /> : null}

      {staged.length ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label={`Files ready to send for ${description.title}`}>
          {staged.map((entry) => (
            <li key={entry.key} className="flex min-w-0 flex-col gap-1 rounded-xl border border-blue-500/35 bg-blue-500/10 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="grid min-w-0 gap-0.5">
                <span className="min-w-0 text-sm font-semibold text-app-text [overflow-wrap:anywhere]">{entry.name}</span>
                <span className="text-xs text-app-muted">{entry.detail}</span>
              </div>
              <Button type="button" variant="secondary" className="!min-h-8 !px-3 !py-1 !text-xs" onClick={() => removeStaged(entry.key)} disabled={busy}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={confirm} disabled={!answerable || busy}>
          {busy ? 'Sending…' : 'Send to the Admissions Office'}
        </Button>
        <span className="text-xs text-app-muted" aria-live="polite">
          {remaining > 0
            ? `${stagedCount} of ${needed} file${needed === 1 ? '' : 's'} chosen. Add ${remaining} more to send.`
            : `${stagedCount} file${stagedCount === 1 ? '' : 's'} ready to send.`}
        </span>
      </div>
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
  );
}
