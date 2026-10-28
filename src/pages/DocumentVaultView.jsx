import { useMemo, useState } from 'react';
import { Clock, Eye, FileImage, FileText, Layers, Lock, RotateCcw, Search, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
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

// Status drives the card's accent bar, file icon tile, and status icon.
const DOCUMENT_STATUS_STYLES = {
  Verified: { tone: 'success', bar: 'before:bg-emerald-500', tile: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', icon: ShieldCheck },
  Pending: { tone: 'warning', bar: 'before:bg-amber-500', tile: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', icon: Clock },
  Rejected: { tone: 'danger', bar: 'before:bg-rose-500', tile: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', icon: RotateCcw },
};

const IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp|gif|heic)$/i;

function VaultMetric({ icon: Icon, label, value, note, tone }) {
  return (
    <article className="page-metric relative overflow-hidden rounded-app border bg-app-card p-4 shadow-app backdrop-blur">
      <div className={`absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl ${tone}`} aria-hidden="true"><Icon size={18} /></div>
      <span className="pr-12 text-xs font-semibold">{label}</span>
      <strong className="!text-3xl">{value}</strong>
      <p className="text-xs">{note}</p>
    </article>
  );
}

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

  const countByStatus = (value) => documents.filter((doc) => doc.verificationStatus === value).length;

  return (
    <div className="blue-action-view grid gap-4">
      <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-500/10 blur-2xl" aria-hidden="true" />
        <div className="page-title-copy relative">
          <span className="page-section-label">Document Vault</span>
          <h2>Upload once, reuse across applications</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">Keep your proofs in one private place. Attach the same verified file to as many applications as you need.</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <VaultMetric icon={Layers} label="Total documents" value={documents.length} note="Stored in your Document Vault" tone="bg-blue-500/15 text-blue-700 dark:text-blue-300" />
        <VaultMetric icon={ShieldCheck} label="Verified" value={countByStatus('Verified')} note="Ready to reuse" tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
        <VaultMetric icon={Clock} label="Pending review" value={countByStatus('Pending')} note="Awaiting Admissions Office review" tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" />
        <VaultMetric icon={RotateCcw} label="Needs resubmission" value={countByStatus('Rejected')} note="Reverted for resubmission" tone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
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
          <label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find a file</span><span className="relative block"><Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-app-muted" aria-hidden="true" /><input className="!pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" /></span></label>
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
            const statusStyle = DOCUMENT_STATUS_STYLES[doc.verificationStatus] || DOCUMENT_STATUS_STYLES.Pending;
            const StatusIcon = statusStyle.icon;
            const FileIcon = IMAGE_FILE_PATTERN.test(doc.fileName || '') ? FileImage : FileText;
            const proofLabels = getDocumentLinkedAttributes(doc, profile).map((key) => getVerifiableAttributeOption(key)?.label || key);
            return (
            <article key={doc.id} className={`document-result-card group relative grid gap-4 overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 pl-6 shadow-sm transition before:absolute before:inset-y-0 before:left-0 before:w-1.5 hover:-translate-y-0.5 hover:shadow-app ${statusStyle.bar}`}>
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${statusStyle.tile}`} aria-hidden="true"><FileIcon size={20} /></span>
                  <div className="min-w-0">
                    <h3 className="m-0 text-lg font-bold text-app-text [overflow-wrap:anywhere]">{doc.title}</h3>
                    <p className="mt-1 text-sm text-app-muted [overflow-wrap:anywhere]">{doc.fileName} <span className="mx-1 text-app-border">•</span> {getDocumentTypeLabel(doc.documentType)}</p>
                  </div>
                </div>
                <StatusBadge className="gap-1.5" tone={statusStyle.tone}><StatusIcon size={13} aria-hidden="true" />{getDocumentStatusLabel(doc.verificationStatus)}</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-app-border/60 pt-3 text-xs text-app-muted">
                <span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Uploaded</strong> {fmtDate(doc.uploadedAt)}</span>
                <span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Used in</strong> {usage.count} {usage.count === 1 ? 'application' : 'applications'}</span>
                {proofLabels.length ? (
                  <span className="rounded-full bg-app-muted-surface px-3 py-1"><strong className="text-app-text">Proof for</strong> {proofLabels.join(', ')}</span>
                ) : null}
              </div>
              <DocumentRejectionReason doc={doc} />
              <DocumentDecisionRecord doc={doc} showReviewer={false} />
              {onResolveDocument && replacementApplications.length ? (
                <div className="grid gap-2 rounded-xl border border-rose-400/40 bg-rose-500/5 p-3">
                  <p className="m-0 flex items-start gap-2 text-sm text-app-text">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" />
                    <span>This file was reverted for resubmission. Replace it so the review can continue.</span>
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
                <Button variant="secondary" type="button" className="gap-2" onClick={() => setPreview(doc)}><Eye size={16} aria-hidden="true" />View</Button>
                {usage.lockedBy
                  ? <span className="inline-flex items-center gap-1.5 text-xs text-app-muted"><Lock size={13} aria-hidden="true" />Locked: attached to your submitted {usage.lockedBy} application</span>
                  : <Button variant="danger" type="button" className="gap-2" onClick={() => onDelete(doc.id)}><Trash2 size={16} aria-hidden="true" />Delete</Button>}
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

