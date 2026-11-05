import { useRef, useState } from 'react';
import { ArrowLeft, FileText, Lock, ShieldCheck } from 'lucide-react';
import { Button, ModalShell, StatusBadge } from '../components/ui';
import { LEGAL_DOCUMENT_KEYS, PRIVACY_NOTICE_VERSION, getLegalDocument, getPrivacyReaderRows } from '../lib/legalDocs';

// One glyph per document, so the tabs and the entry points read as one set.
const DOC_ICONS = { privacy: ShieldCheck, storage: Lock, terms: FileText };
const DOC_TAB_LABELS = { privacy: 'Privacy Policy', storage: 'Cookies and storage', terms: 'Terms of Use' };

export const getLegalDocLabel = (key) => DOC_TAB_LABELS[key] || DOC_TAB_LABELS.privacy;

function DocumentTable({ table }) {
  // The privacy page's reader matrix is derived from the role constants, so a new
  // role can never be missing from the policy. Every other table is literal copy.
  const { columns, rows } = table?.key === 'readers'
    ? { columns: ['Role', 'Can read', 'Never reads'], rows: getPrivacyReaderRows() }
    : table;

  if (!columns?.length || !rows?.length) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-app-border">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <thead className="bg-app-surface">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="border-b border-app-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-app-border px-3 py-2 text-app-text [overflow-wrap:anywhere]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentSection({ docKey, section }) {
  return (
    <section className="legal-document-section min-w-0 border-b border-app-border py-5 last:border-b-0 last:pb-0 first:pt-5">
      <h3 id={`${docKey}-${section.id}`} className="m-0 scroll-mt-24 text-lg font-semibold text-app-text">
        {section.heading}
      </h3>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph.slice(0, 40)} className="mb-0 mt-2 text-sm leading-relaxed text-app-text">
          {paragraph}
        </p>
      ))}
      {section.list?.length ? (
        <ul className="mb-0 mt-3 grid gap-2 pl-5 text-sm leading-relaxed text-app-text">
          {section.list.map((entry) => (
            <li key={entry.slice(0, 40)}>{entry}</li>
          ))}
        </ul>
      ) : null}
      {section.table ? <DocumentTable table={section.table} /> : null}
    </section>
  );
}

// The document body: the tab strip, the document heading, and the sections. The
// same component is the authenticated page and the pre-login dialog, so the copy
// can never differ between the two.
export default function LegalView({ initialDoc = 'privacy', onSelectDoc = null, onBack = null }) {
  const seed = LEGAL_DOCUMENT_KEYS.includes(initialDoc) ? initialDoc : 'privacy';
  // The open document is derived rather than synced by an effect: a document named by
  // an entry point wins immediately, and a tab click records its own choice against
  // the seed it was made for.
  const [selection, setSelection] = useState({ seed, doc: seed });
  const activeDoc = selection.seed === seed ? selection.doc : seed;
  const bodyRef = useRef(null);

  const document = getLegalDocument(activeDoc);

  const selectDoc = (key) => {
    setSelection({ seed, doc: key });
    if (onSelectDoc) onSelectDoc(key);
    bodyRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="grid min-w-0 gap-4" ref={bodyRef}>
      <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="relative flex min-w-0 flex-wrap items-center gap-2">
          {onBack && (
            <Button variant="ghost" className="shrink-0 px-3" type="button" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </Button>
          )}
          <div className="legal-document-tabs flex min-w-0 flex-wrap gap-2" role="tablist" aria-label="Privacy, storage, and terms">
            {LEGAL_DOCUMENT_KEYS.map((key) => {
              const Icon = DOC_ICONS[key];
              const isActive = key === activeDoc;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${
                    isActive
                      ? 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm'
                      : 'border border-app-border bg-app-muted-surface text-app-text hover:bg-blue-500/10'
                  }`}
                  onClick={() => selectDoc(key)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{DOC_TAB_LABELS[key]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative mt-4 flex min-w-0 flex-wrap items-end justify-between gap-4">
          <div className="page-title-copy">
            <span className="page-section-label">Privacy and data</span>
            <h2>{document.title}</h2>
            <p className="mt-2 max-w-2xl text-sm text-app-muted">{document.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">Updated {document.updated}</StatusBadge>
            <StatusBadge tone="neutral">Version {PRIVACY_NOTICE_VERSION}</StatusBadge>
          </div>
        </div>
      </section>

      <div className="legal-document-body min-w-0 rounded-app border bg-app-card px-5 shadow-app backdrop-blur">
        {document.sections.map((section) => (
          <DocumentSection key={`${activeDoc}-${section.id}`} docKey={activeDoc} section={section} />
        ))}
        <p className="legal-document-disclaimer m-0 border-t border-app-border py-4 text-sm text-app-muted">
          This notice is prototype wording written for a capstone study. It is not the University official privacy notice, and it needs review by the University Data Protection Officer before it is used outside a demonstration. Questions about a scholarship go to the Office of Admission and Aid.
        </p>
      </div>
    </div>
  );
}

// The pre-login and in-page dialog form. The login screen has no workspace route, so
// the documents open in place there rather than behind a sign-in.
export function LegalDocumentDialog({ doc = 'privacy', onClose }) {
  return (
    <ModalShell
      title={getLegalDocLabel(doc)}
      onClose={onClose}
      className="app-scroll max-h-[86vh] w-[min(60rem,calc(100vw-1.5rem))] overflow-y-auto"
    >
      <LegalView initialDoc={doc} />
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
      </div>
    </ModalShell>
  );
}

