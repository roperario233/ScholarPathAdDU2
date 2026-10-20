import { useEffect, useState } from 'react';
import { ModalShell } from './ui';
import { getSupabaseDocumentUrl } from '../lib/supabaseData';
import { isImageFileName } from '../lib/documentStorage';

// Inline preview of a stored Document Vault file. Fetches a short-lived signed
// URL for the private bucket object (RLS-checked against the signed-in caller),
// then renders images inline and PDFs in an iframe, with an escape hatch to open
// the file in a new tab. A document with no storage_path, or a failed signed-URL
// request, shows a readable message instead of an empty frame. The staff review
// modal renders it in its Documents pane; DocumentPreviewModal wraps it.
export function DocumentPreview({ doc, frameClassName = 'h-[70vh]', imageClassName = 'max-h-[70vh]' }) {
  const [state, setState] = useState({ url: '', error: '' });

  useEffect(() => {
    let active = true;
    if (!doc?.storagePath) {
      setState({ url: '', error: 'This document has no stored file to open.' });
      return () => { active = false; };
    }
    setState({ url: '', error: '' });
    getSupabaseDocumentUrl(doc.storagePath).then(({ url, error }) => {
      if (!active) return;
      setState(error || !url
        ? { url: '', error: 'The document could not be opened. Please try again.' }
        : { url, error: '' });
    });
    return () => { active = false; };
  }, [doc?.storagePath]);

  if (state.error) return <p className="m-0 text-sm text-app-muted">{state.error}</p>;
  if (!state.url) return <p className="m-0 text-sm text-app-muted">Loading document…</p>;
  return (
    <div className="grid gap-3">
      {isImageFileName(doc.fileName) ? (
        <img src={state.url} alt={doc.title} className={`mx-auto w-auto max-w-full rounded-xl border border-app-border object-contain ${imageClassName}`} />
      ) : (
        <iframe src={state.url} title={doc.title} className={`w-full rounded-xl border border-app-border bg-white ${frameClassName}`} />
      )}
      <a className="link-btn w-fit" href={state.url} target="_blank" rel="noreferrer">Open in a new tab</a>
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
