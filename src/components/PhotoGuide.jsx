import { getPhotoGuide } from '../lib/photoGuide';

// The bullet-point photo rules a student sees before taking or uploading a
// photo. Shared by the capture modal, the Document Vault upload card, the
// application workspace, and the rejected-file replacement, so the guidance and
// the reviewer's rejection reasons stay aligned. The profile photo has no
// guide, so a caller without a guide or photo document type renders nothing.
export default function PhotoGuide({ documentType = '', guide = null, defaultOpen = false, className = '' }) {
  const resolved = guide || (documentType ? getPhotoGuide(documentType) : null);
  if (!resolved) return null;
  return (
    <details open={defaultOpen} className={`group rounded-xl border border-app-border bg-app-surface/70 p-3 ${className}`}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 [&::-webkit-details-marker]:hidden">
        <span>{resolved.title}</span>
        <span aria-hidden="true" className="text-app-muted transition group-open:rotate-180">{'\u25BE'}</span>
      </summary>
      {resolved.summary ? <p className="m-0 mt-2 text-xs text-app-muted">{resolved.summary}</p> : null}
      <ul className="m-0 mt-2 grid list-disc gap-1 pl-5 text-xs text-app-muted">
        {resolved.points.map((point) => <li key={point}>{point}</li>)}
      </ul>
    </details>
  );
}
