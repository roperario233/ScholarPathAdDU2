import { useEffect, useState } from 'react';
import { ModalShell } from './ui';
import { getSupabaseDocumentUrl } from '../lib/supabaseData';
import { isImageFileName } from '../lib/documentStorage';

// Shared preview for a stored Document Vault file. Fetches a short-lived signed
// URL for the private bucket object (RLS-checked against the signed-in caller),
// then renders images inline and PDFs in an iframe, with an escape hatch to open
// the file in a new tab. A document with no storage_path, or a failed signed-URL
// request, shows a readable message instead of an empty frame.
export default function DocumentPreviewModal({ doc, onClose }) {
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

  return (
    <ModalShell title={doc?.title || 'Document'} onClose={onClose} className="w-[min(900px,100%)]">
      {state.error ? (
        <p className="m-0 text-sm text-app-muted">{state.error}</p>
      ) : state.url ? (
        <div className="grid gap-3">
          {isImageFileName(doc.fileName) ? (
            <img src={state.url} alt={doc.title} className="mx-auto max-h-[70vh] w-auto rounded-xl border border-app-border" />
          ) : (
            <iframe src={state.url} title={doc.title} className="h-[70vh] w-full rounded-xl border border-app-border bg-white" />
          )}
          <a className="link-btn w-fit" href={state.url} target="_blank" rel="noreferrer">Open in a new tab</a>
        </div>
      ) : (
        <p className="m-0 text-sm text-app-muted">Loading document…</p>
      )}
    </ModalShell>
  );
}
