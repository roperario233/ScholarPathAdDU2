import { ModalShell } from './ui';
import DocumentUploadForm from './DocumentUploadForm';

// Upload a proof without leaving My Profile. "Attach proof" and the document
// checklist's "Upload" open this dialog with the attribute and/or document type
// preselected; a successful upload closes it, and the badge behind it re-derives
// from the vault. `blue-action-view` carries the shell's button palette that the
// vault page gets from its own wrapper.
export default function DocumentUploadModal({ profile, presetAttribute = '', presetDocumentType = '', onUpload, onClose }) {
  return (
    <ModalShell title="Upload a proof" closeLabel="Cancel" onClose={onClose} className="blue-action-view w-[min(560px,100%)]">
      <DocumentUploadForm
        profile={profile}
        onUpload={onUpload}
        onUploaded={onClose}
        presetAttribute={presetAttribute}
        presetDocumentType={presetDocumentType}
      />
    </ModalShell>
  );
}
