import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../components/pageParts';
import { Button, StatusBadge } from '../components/ui';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import DocumentUploadForm from '../components/DocumentUploadForm';
import { DocumentDecisionRecord, DocumentRejectionReason } from '../components/ApplicationParts';
import { fmtDate } from '../lib/formatters';
import { getDocumentStatusLabel, getDocumentTypeLabel, DOCUMENT_REPLACEMENT_STATUSES } from '../lib/constants';
import { getVerifiableAttributeOption } from '../lib/profile';
import { getDocumentLinkedAttributes, getOutdatedProofAttributes } from '../lib/verification';
import { isAdduInternalProgram } from '../lib/eligibility';

// Why a proof no longer covers its attribute, phrased for the student.
const outdatedProofMessage = ({ key, reason }) => {
  const label = getVerifiableAttributeOption(key)?.label || key;
  return reason === 'year'
    ? `This ${label} proof is from an earlier academic year. Upload a current one.`
    : `Your ${label} changed after this upload. Upload a new proof.`;
};

export default function DocumentVaultView({ documents, applications = [], profile = null, onUpload, onDelete, onResolveDocument, presetAttribute = '', presetDocumentType = '' }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [preview, setPreview] = useState(null);
  // Usage is derived from the applications that attach each file, so the count
  // always matches the application workspace. A file a submitted application
  // relies on is locked until that review ends.
  const usageByDocument = useMemo(() => {
    const usage = {};
    applications.forEach((entry) => (entry.attachedDocuments || []).forEach((id) => {
      usage[id] = usage[id] || { count: 0, lockedBy: null };
      usage[id].count += 1;
      if (entry.status !== 'Draft' && !usage[id].lockedBy) usage[id].lockedBy = entry.scholarshipTitle;
    }));
    return usage;
  }, [applications]);
  // A Rejected file the student can still replace: the applications that attach
  // it and are still before endorsement. The vault links straight to them, so a
  // rejected file that is locked by a submitted application is never a dead end.
  const replaceableApplicationsByDocument = useMemo(() => {
    const map = {};
    applications.forEach((entry) => {
      if (!DOCUMENT_REPLACEMENT_STATUSES.includes(entry.status)) return;
      // Only the in-scope AdDU tracks can be acted on; a tracked-only catalog
      // entry has no replace flow, so do not offer a dead-end link.
      if (!isAdduInternalProgram({ title: entry.scholarshipTitle })) return;
      (entry.attachedDocuments || []).forEach((id) => {
        map[id] = map[id] || [];
        map[id].push(entry);
      });
    });
    return map;
  }, [applications]);
  // A proof goes stale when the student changes the value it attests or, for
  // annual attributes, when a new academic year starts (src/lib/verification.js).
  const outdatedByDocument = useMemo(() => Object.fromEntries(
    documents.map((doc) => [doc.id, getOutdatedProofAttributes(doc, { profile })]),
  ), [documents, profile]);
  const filtered = useMemo(() => documents.filter((doc) => {
    const text = `${doc.title} ${doc.fileName} ${doc.documentType}`.toLowerCase();
    const matchesStatus = status === 'all'
      || (status === 'outdated' ? outdatedByDocument[doc.id]?.length > 0 : doc.verificationStatus === status);
    return (!query.trim() || text.includes(query.trim().toLowerCase())) && matchesStatus;
  }), [documents, query, status, outdatedByDocument]);

  return (
    <div className="blue-action-view grid gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="page-metric rounded-app border bg-app-card p-4 shadow-app backdrop-blur"><span className="text-xs font-semibold">Total documents</span><strong className="!text-2xl">{documents.length}</strong><p className="text-xs">Stored in your Document Vault</p></article>
        <article className="page-metric rounded-app border bg-app-card p-4 shadow-app backdrop-blur"><span className="text-xs font-semibold">Verified</span><strong className="!text-2xl">{documents.filter((doc) => doc.verificationStatus === 'Verified').length}</strong><p className="text-xs">Ready to reuse</p></article>
        <article className="page-metric rounded-app border bg-app-card p-4 shadow-app backdrop-blur"><span className="text-xs font-semibold">Pending review</span><strong className="!text-2xl">{documents.filter((doc) => doc.verificationStatus === 'Pending').length}</strong><p className="text-xs">Awaiting Admissions Office review</p></article>
        <article className="page-metric rounded-app border bg-app-card p-4 shadow-app backdrop-blur"><span className="text-xs font-semibold">Needs resubmission</span><strong className="!text-2xl">{documents.filter((doc) => doc.verificationStatus === 'Rejected').length}</strong><p className="text-xs">Reverted for resubmission</p></article>
      </section>

      <Card title="Upload a document">
        <DocumentUploadForm
          profile={profile}
          onUpload={onUpload}
          presetAttribute={presetAttribute}
          presetDocumentType={presetDocumentType}
        />
      </Card>

      <Card title="Your documents" className="document-list-card">
        <div className="document-filter-toolbar grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4">
          <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find a file</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" /></label>
          <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Verification status</span><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter documents"><option value="all">All statuses</option><option>Verified</option><option>Pending</option><option value="Rejected">Reverted for resubmission</option><option value="outdated">Outdated proof</option></select></label>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-b border-app-border/70 px-1 pb-3">
          <p className="m-0 text-sm font-semibold text-app-text">{filtered.length} {filtered.length === 1 ? 'document' : 'documents'} found</p>
          <span className="text-xs text-app-muted">Reusable across applications</span>
        </div>
        <div className="mt-4 grid max-h-[560px] gap-4 overflow-y-auto pr-2">
          {filtered.length ? filtered.map((doc) => {
            const usage = usageByDocument[doc.id] || { count: 0, lockedBy: null };
            const outdated = outdatedByDocument[doc.id] || [];
            const replacementApplications = doc.verificationStatus === 'Rejected'
              ? replaceableApplicationsByDocument[doc.id] || []
              : [];
            return (
            <article key={doc.id} className="document-result-card group grid gap-4 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-app">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="m-0 text-lg font-bold text-app-text">{doc.title}</h3>
                  <p className="mt-1 text-sm text-app-muted">{doc.fileName} <span className="mx-1 text-app-border">•</span> {getDocumentTypeLabel(doc.documentType)}</p>
                </div>
                <StatusBadge tone={doc.verificationStatus === 'Verified' ? 'success' : doc.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-app-border/60 pt-3 text-sm text-app-muted">
                <span><strong>Uploaded</strong> {fmtDate(doc.uploadedAt)}</span>
                <span><strong>Used in</strong> {usage.count} {usage.count === 1 ? 'application' : 'applications'}</span>
                {getDocumentLinkedAttributes(doc, profile).length ? (
                  <span><strong>Proof for</strong> {getDocumentLinkedAttributes(doc, profile).map((key) => getVerifiableAttributeOption(key)?.label || key).join(', ')}</span>
                ) : null}
              </div>
              <DocumentRejectionReason doc={doc} />
              <DocumentDecisionRecord doc={doc} showReviewer={false} />
              {onResolveDocument && replacementApplications.length ? (
                <div className="grid gap-2 rounded-xl border border-rose-400/40 p-3">
                  <p className="m-0 text-sm text-app-text">
                    This file was reverted for resubmission. Replace it so the review can continue.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {replacementApplications.map((entry) => (
                      <Button key={entry.id} variant="primary" type="button" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => onResolveDocument(entry.id)}>
                        Open {entry.scholarshipTitle}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {outdated.length ? (
                <div className="grid gap-2 rounded-xl border border-rose-400/30 bg-rose-500/5 p-3">
                  {outdated.map((entry) => (
                    <p key={entry.key} className="m-0 flex flex-wrap items-center gap-2 text-sm text-app-muted">
                      <StatusBadge tone="danger">Outdated proof</StatusBadge>
                      <span>{outdatedProofMessage(entry)}</span>
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border/60 pt-3">
                <Button variant="secondary" type="button" onClick={() => setPreview(doc)}>View</Button>
                {usage.lockedBy
                  ? <span className="text-xs text-app-muted">Locked: attached to your submitted {usage.lockedBy} application</span>
                  : <button className="inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:-translate-y-px hover:bg-rose-500/15 focus:outline-none focus:ring-4 focus:ring-rose-500/20 dark:text-rose-300" type="button" onClick={() => onDelete(doc.id)}>Delete</button>}
              </div>
            </article>
            );
          }) : <EmptyState title={documents.length ? 'No matching documents' : 'Document vault is empty'} description={documents.length ? 'Try a different search or status filter.' : 'Upload once and reuse across applications.'} />}
        </div>
      </Card>

      {preview ? <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

