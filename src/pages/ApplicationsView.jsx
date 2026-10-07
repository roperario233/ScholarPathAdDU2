import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../components/pageParts';
import { Button, ModalShell, StatusBadge } from '../components/ui';
import { getApplicationProgress } from '../lib/eligibility';
import { applicationStatuses } from '../lib/constants';
import { fmtDate, toPercent } from '../lib/formatters';

const statusTone = { Approved: 'success', Rejected: 'danger', Draft: 'neutral', Submitted: 'info', 'Under Review': 'info', 'For Verification': 'warning', Endorsed: 'warning', Interview: 'info', Recommended: 'info', Released: 'success' };

export default function ApplicationsView({ applications, documents, scholarships, onSubmit }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => applications.filter((entry) => {
    const matchesQuery = !query.trim() || entry.scholarshipTitle.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (status === 'all' || entry.status === status);
  }), [applications, query, status]);
  const selected = applications.find((entry) => entry.id === selectedId);

  const exportReport = (entry) => {
    const scholarship = scholarships.find((item) => item.id === entry.scholarshipId);
    const content = ['SCHOLARPATH ADDU — APPLICATION REPORT', '', `Application: ${entry.scholarshipTitle}`, `ID: ${entry.id}`, `Status: ${entry.status}`, `Progress: ${toPercent(getApplicationProgress(entry.status))}`, `Deadline: ${scholarship ? fmtDate(scholarship.deadline) : 'N/A'}`, `Documents: ${entry.attachedDocuments?.length || 0}`, `Submitted: ${entry.submittedAt ? fmtDate(entry.submittedAt) : 'Not yet'}`, '', entry.notes || ''].join('\n');
    const link = document.createElement('a');
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
    link.download = `Application_${entry.scholarshipTitle.replace(/[^a-z0-9]+/gi, '_')}.txt`;
    link.click();
  };

  return <div className="blue-action-view grid gap-4">
    <Card title="Your applications" className="application-list-card">
      <div className="grid gap-4 rounded-2xl border border-app-border bg-app-surface/60 p-3 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4"><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Find an application</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search applications" aria-label="Search applications" /></label><label className="grid gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Application status</span><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter applications by status"><option value="all">All statuses</option>{applicationStatuses.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="mt-6 flex items-center justify-between gap-3 border-b border-app-border/70 px-1 pb-3"><p className="m-0 text-sm font-semibold text-app-text">{filtered.length} {filtered.length === 1 ? 'application' : 'applications'} found</p><span className="text-xs text-app-muted">Keep your application progress up to date</span></div>
      <div className="mt-4 grid max-h-[560px] gap-4 overflow-y-auto pr-2">
        {filtered.length ? filtered.map((entry) => {
          const scholarship = scholarships.find((item) => item.id === entry.scholarshipId);
          const canSubmit = entry.status === 'Draft';
          return <article key={entry.id} className="application-result-card grid grid-rows-[auto_auto_1fr_auto] items-stretch gap-4 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-app">
            <div className="flex min-w-0 items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3>{entry.scholarshipTitle}</h3><p>{scholarship?.category || 'Scholarship'} · Updated {fmtDate(entry.updatedAt)}</p></div><StatusBadge className="max-w-full shrink-0" tone={statusTone[entry.status] || 'info'}>{entry.status}</StatusBadge></div>
            <div className="h-2 overflow-hidden rounded-full bg-app-muted-surface"><div className="h-full rounded-full bg-gradient-to-r from-ateneo-strong via-ateneo to-ateneo-bright" style={{ width: `${getApplicationProgress(entry.status)}%` }} /></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-app-border/60 pt-3 text-sm text-app-muted"><span><strong>Progress</strong> {toPercent(getApplicationProgress(entry.status))}</span><span><strong>Documents</strong> {entry.documentStatus}</span><span><strong>Deadline</strong> {scholarship ? fmtDate(scholarship.deadline) : 'N/A'}</span></div>
            <p className="m-0 text-sm text-app-muted">{entry.notes}</p>
           <div className="flex flex-wrap items-center gap-3 border-t border-app-border/60 pt-3"><Button type="button" onClick={() => setSelectedId(entry.id)}>View details</Button>{canSubmit && <Button variant="primary" type="button" onClick={() => { if (window.confirm('Submit this application for review? You can no longer edit this draft after submission.')) onSubmit(entry.id); }}>Submit application</Button>}<button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20" type="button" onClick={() => exportReport(entry)}>Export report</button></div>
          </article>;
        }) : <EmptyState title={applications.length ? 'No matching applications' : 'No applications yet'} description={applications.length ? 'Try a different search or status filter.' : 'Track a scholarship from the explorer to create your first application.'} />}
      </div>
    </Card>
    {selected && <ModalShell title={selected.scholarshipTitle} onClose={() => setSelectedId(null)} className="application-detail-modal"><p>{selected.notes}</p><div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-app-muted"><span><strong>Status</strong> {selected.status}</span><span><strong>Attached documents</strong> {selected.attachedDocuments?.length || 0}</span><span><strong>Submitted</strong> {selected.submittedAt ? fmtDate(selected.submittedAt) : 'Not yet'}</span></div><h3>Linked vault files</h3>{selected.attachedDocuments?.length ? <ul className="grid gap-2 pl-5 text-app-muted">{selected.attachedDocuments.map((id) => <li key={id}>{documents.find((doc) => doc.id === id)?.title || 'Document unavailable'}</li>)}</ul> : <p className="text-app-muted">No documents attached yet.</p>}</ModalShell>}
  </div>;
}