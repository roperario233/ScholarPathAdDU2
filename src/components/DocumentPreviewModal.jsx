import { useEffect, useState } from 'react';
import { ModalShell } from './ui';
import { getSupabaseDocumentUrl } from '../lib/supabaseData';
import { isImageFileName } from '../lib/documentStorage';

// Fetches the short-lived signed URL for a stored Document Vault file. The review
// pane calls this once and hands the result to both its "Open in a new tab"
// action and the inline preview, so one selected file needs one request.
export function useDocumentPreviewUrl(doc, enabled = true) {
  const documentId = doc?.id || '';
  const [state, setState] = useState({ documentId, url: '', error: '' });

  useEffect(() => {
    let active = true;
    if (!enabled) return () => { active = false; };
    if (!doc?.storagePath) {
      setState({ documentId, url: '', error: 'This document has no stored file to open.' });
      return () => { active = false; };
    }
    setState({ documentId, url: '', error: '' });
    getSupabaseDocumentUrl(doc.storagePath).then(({ url, error }) => {
      if (!active) return;
      setState(error || !url
        ? { documentId, url: '', error: 'The document could not be opened. Please try again.' }
        : { documentId, url, error: '' });
    });
    return () => { active = false; };
  }, [documentId, doc?.storagePath, enabled]);

  // A newly selected file must never render the previous file's signed URL while
  // its own request is in flight, so a row that belongs to another document reads
  // as loading until the effect catches up.
  if (state.documentId !== documentId) return { documentId, url: '', error: '' };
  return state;
}

// Inline preview of a stored Document Vault file: the short-lived signed URL for
// the private bucket object (RLS-checked against the signed-in caller), then
// images inline and PDFs in an iframe, with an escape hatch to open the file in a
// new tab. A document with no storage_path, or a failed signed-URL request, shows
// a readable message instead of an empty frame. The staff review modal renders it
// in its Documents pane; DocumentPreviewModal wraps it. `url`/`error` let a caller
// that already fetched the URL skip the request, and `showOpenLink={false}` moves
// the escape hatch to the caller (the review pane puts it beside the verification
// actions so it stays at the top of the pane).
export function DocumentPreview({
  doc,
  url,
  error,
  showOpenLink = true,
  frameClassName = 'h-[70vh]',
  imageClassName = 'max-h-[70vh]',
}) {
  const ownsRequest = url === undefined;
  const fetched = useDocumentPreviewUrl(ownsRequest ? doc : null, ownsRequest);
  const resolvedUrl = ownsRequest ? fetched.url : url;
  const resolvedError = ownsRequest ? fetched.error : (error || '');

  if (resolvedError) return <p className="m-0 text-sm text-app-muted">{resolvedError}</p>;
  if (!resolvedUrl) return <p className="m-0 text-sm text-app-muted">Loading document…</p>;
  return (
    <div className="grid gap-3">
      {isImageFileName(doc.fileName) ? (
        <img src={resolvedUrl} alt={doc.title} className={`mx-auto w-auto max-w-full rounded-xl border border-app-border object-contain ${imageClassName}`} />
      ) : (
        <iframe src={resolvedUrl} title={doc.title} className={`w-full rounded-xl border border-app-border bg-white ${frameClassName}`} />
      )}
      {showOpenLink ? <a className="link-btn w-fit" href={resolvedUrl} target="_blank" rel="noreferrer">Open in a new tab</a> : null}
    </div>
  );
}

export default function DocumentPreviewModal({ doc, onClose }) {
  return (
    <ModalShell title={doc?.title || 'Document'} onClose={onClose} className="w-[min(900px,100%)]">
      <DocumentPreview doc={doc} />
    </ModalShell>
  );
}
