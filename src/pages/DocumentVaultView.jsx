import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../components/pageParts';
import { StatusBadge } from '../components/ui';
import { SelectPicker } from './LoginScreen';
import { fmtDate } from '../lib/formatters';
import { documentTypeOptions, getDocumentTypeLabel } from '../lib/constants';

export default function DocumentVaultView({ documents, onUpload, onDelete }) {
  const [type, setType] = useState(documentTypeOptions[0].value);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [formError, setFormError] = useState('');
  const filtered = useMemo(() => documents.filter((doc) => {
    const text = `${doc.title} ${doc.fileName} ${doc.documentType}`.toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase())) && (status === 'all' || doc.verificationStatus === status);
  }), [documents, query, status]);
  const handleSubmit = (event) => {
    const file = event.currentTarget.documentFile.files[0];
    if (!event.currentTarget.documentTitle.value.trim() || !file) { event.preventDefault(); setFormError('Add a document title and choose a file.'); return; }
    if (file.size > 10 * 1024 * 1024) { event.preventDefault(); setFormError('Files must be 10 MB or smaller.'); return; }
    setFormError('');
    onUpload(event);
    setType(documentTypeOptions[0].value);
  };
  return <div className="blue-action-view grid gap-4">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="page-metric rounded-app border bg-app-card p-5 shadow-app backdrop-blur"><span>Total documents</span><strong>{documents.length}</strong><p>Stored in your Document Vault</p></article>
      <article className="page-metric rounded-app border bg-app-card p-5 shadow-app backdrop-blur"><span>Verified</span><strong>{documents.filter((d) => d.verificationStatus === 'Verified').length}</strong><p>Ready to reuse</p></article>
      <article className="page-metric rounded-app border bg-app-card p-5 shadow-app backdrop-blur"><span>Pending review</span><strong>{documents.filter((d) => d.verificationStatus === 'Pending').length}</strong><p>Awaiting Admissions Office review</p></article>
      <article className="page-metric rounded-app border bg-app-card p-5 shadow-app backdrop-blur"><span>Rejected</span><strong>{documents.filter((d) => d.verificationStatus === 'Rejected').length}</strong><p>Needs replacement</p></article>
    </section>
    <Card title="Upload a document"><form className="vault-upload-form grid gap-4" onSubmit={handleSubmit}><label><span>Document title</span><input name="documentTitle" required placeholder="BIR-stamped ITR" /></label><label><span>File</span><input name="documentFile" required type="file" accept=".pdf,.jpg,.jpeg,.png" /><small className="field-hint">PDF, JPG, or PNG · maximum 10 MB</small></label><SelectPicker label="Document type" value={type} onChange={setType} options={documentTypeOptions} idPrefix="vault-document-type" /><input type="hidden" name="documentType" value={type} />{formError && <p className="form-error" role="alert">{formError}</p>}<button className="vault-upload-button inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" type="submit">Upload to vault</button></form></Card>
    <Card title="Your documents" className="document-list-card"><div className="document-filter-toolbar grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4"><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find a file</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents" aria-label="Search documents" /></label><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Verification status</span><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter documents"><option value="all">All statuses</option><option>Verified</option><option>Pending</option><option>Rejected</option></select></label></div><div className="mt-6 flex items-center justify-between gap-3 border-b border-app-border/70 px-1 pb-3"><p className="m-0 text-sm font-semibold text-app-text">{filtered.length} {filtered.length === 1 ? 'document' : 'documents'} found</p><span className="text-xs text-app-muted">Reusable across applications</span></div><div className="mt-4 grid max-h-[560px] gap-4 overflow-y-auto pr-2">{filtered.length ? filtered.map((doc) => <article key={doc.id} className="document-result-card group grid gap-4 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-app"><div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0"><h3 className="m-0 text-lg font-bold text-app-text">{doc.title}</h3><p className="mt-1 text-sm text-app-muted">{doc.fileName} <span className="mx-1 text-app-border">•</span> {getDocumentTypeLabel(doc.documentType)}</p></div><StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{doc.verificationStatus}</StatusBadge></div><div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-app-border/60 pt-3 text-sm text-app-muted"><span><strong>Uploaded</strong> {fmtDate(doc.uploadedAt)}</span><span><strong>Used in</strong> {doc.sharedWith?.length || 0} {doc.sharedWith?.length === 1 ? 'application' : 'applications'}</span></div><div className="flex items-center justify-between gap-3 border-t border-app-border/60 pt-3"><span className="text-xs text-app-muted">Stored in your vault</span><button className="inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:-translate-y-px hover:bg-rose-500/15 focus:outline-none focus:ring-4 focus:ring-rose-500/20 dark:text-rose-300" type="button" onClick={() => onDelete(doc.id)}>Delete</button></div></article>) : <EmptyState title={documents.length ? 'No matching documents' : 'Document vault is empty'} description={documents.length ? 'Try a different search or status filter.' : 'Upload transcripts, IDs, and income proofs once to reuse them.'} />}</div></Card>
  </div>;
}