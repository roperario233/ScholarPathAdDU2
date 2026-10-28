import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, CircleDashed, CircleHelp, FileText, XCircle } from 'lucide-react';
import { EmptyState } from '../components/pageParts';
import { ModalShell } from '../components/ui';
import ScholarshipTrackIcon from '../components/ScholarshipTrackIcon';
import { coverageTypes } from '../lib/constants';
import { getDeadlineStatus, getInternalRuleFamily, isAdduInternalProgram } from '../lib/eligibility';
import { getEligibilityChecklist } from '../lib/eligibilityChecklist';
import { SelectPicker } from './LoginScreen';
import { describeRequirementTypes, getScholarshipRequirements } from '../lib/applicationRequirements';
import { getScholarshipGuide } from '../lib/scholarshipGuide';
import { APPLICATION_FORM_SECTIONS, getApplicationProfileGate, getStandingRequirements } from '../lib/profile';

// The My Profile sections the "Needed to apply" items live in, keyed like the
// section menu in src/pages/ProfileView.jsx.
// "3. Family details": the numbered part of the application form in My Profile.
const PROFILE_SECTION_LABELS = Object.fromEntries(
  APPLICATION_FORM_SECTIONS.map((section, index) => [section.key, `${index + 1}. ${section.label}`]),
);

const DEADLINE_TONES = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  info: 'bg-blue-500/15 text-blue-700 dark:text-blue-200',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  danger: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  neutral: 'bg-app-surface text-app-muted',
};

const VERDICTS = {
  eligible: { icon: CheckCircle2, title: 'You qualify', tone: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  ineligible: { icon: XCircle, title: 'Not eligible yet', tone: 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  incomplete: { icon: CircleHelp, title: 'Answers needed', tone: 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
};

const ROW_STATUS = {
  pass: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-300', label: 'Met' },
  fail: { icon: XCircle, className: 'text-rose-600 dark:text-rose-300', label: 'Not met' },
  unanswered: { icon: CircleDashed, className: 'text-amber-600 dark:text-amber-300', label: 'Not answered' },
};

const secondaryButton = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-app-border bg-app-surface px-3 py-2 text-left text-sm font-semibold text-app-text transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20';
const primaryButton = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20';

const verdictSummary = ({ verdict, rows, failed, unanswered }) => {
  if (verdict === 'eligible') return `All ${rows.length} checks met`;
  return [failed && `${failed} not met`, unanswered && `${unanswered} not answered`].filter(Boolean).join(' · ');
};

function EligibilityChecklist({ checklist, rowSpan, onOpenProfileSection }) {
  // One subgrid row per criterion, so the same check sits at the same height in
  // every card; gap-y-0 lets the rows abut inside the card's row gap.
  return (
    <ul className="m-0 grid list-none grid-rows-subgrid gap-y-0 p-0" style={{ gridRow: `span ${rowSpan}` }} aria-label="Smart Eligibility Checker results">
      {checklist.rows.map((row) => {
        const status = ROW_STATUS[row.status];
        const StatusIcon = status.icon;
        return (
          <li key={row.key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-app-border py-2.5 first:border-t-0 first:pt-0">
            <StatusIcon size={18} className={`mt-0.5 ${status.className}`} role="img" aria-label={status.label} />
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-semibold text-app-text">{row.label}</span>
                <span className={`text-sm ${row.answer == null ? 'italic text-app-muted' : 'text-app-text'}`}>{row.answer ?? 'Not answered'}</span>
              </div>
              <span className="text-xs text-app-muted">Needs: {row.required}</span>
              {row.status !== 'pass' && row.messages.map((message) => (
                <span key={message} className={`text-xs font-medium ${status.className}`}>{message}</span>
              ))}
              {row.status !== 'pass' && row.section && onOpenProfileSection && (
                <button type="button" className="mt-1 inline-flex w-fit items-center gap-1 rounded-lg border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-text" onClick={() => onOpenProfileSection(row.section.key, row.field)}>
                  Update {row.section.label}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The documents a track asks of this student, in a dialog portaled to <body>:
// the card's backdrop blur would otherwise trap the fixed overlay inside it.
function RequiredDocumentsModal({ scholarship, requirements, profile, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  const standing = getStandingRequirements(profile);
  const standingNote = !standing.yearStanding
    ? 'Documents every applicant submits'
    : standing.isIncomingFirstYear ? 'For incoming first-year applicants' : 'For current Ateneo students and transferees';

  return createPortal(
    <ModalShell title="Required documents" onClose={onClose} className="flex w-[min(640px,100%)] max-h-[min(86vh,760px)] flex-col">
      <p className="m-0 text-sm text-app-muted"><strong className="text-app-text">{scholarship.title}</strong> · {standingNote}</p>
      <ol className="app-scroll m-0 mt-4 grid list-none gap-2 overflow-y-auto p-0">
        {requirements.map((item, index) => (
          <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-app-border bg-app-surface p-3">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-700 dark:text-blue-200">{index + 1}</span>
            <div className="grid min-w-0 gap-0.5">
              <strong className="text-sm text-app-text">{item.label}</strong>
              <span className="text-xs text-app-muted">Accepts: {describeRequirementTypes(item)}</span>
              {item.claim && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Required by your Application Form answer</span>}
            </div>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-4 text-xs text-app-muted">Upload them to your Document Vault, or attach them when you apply.</p>
    </ModalShell>,
    document.body,
  );
}

// The card's fixed slots (header, coverage, verdict, documents, action) plus one
// row per checklist criterion. Every card spans the same rows of the page grid
// as a subgrid, so each slot lines up across the cards in a row.
const CARD_SLOT_ROWS = 5;

function ScholarshipCard({ scholarship, profile, profileGate, checklistRows, onApply, onOpenProfileSection, applyError }) {
  const isInternal = isAdduInternalProgram(scholarship);
  const guide = getScholarshipGuide(scholarship);
  const deadline = getDeadlineStatus(scholarship.deadline);
  const checklist = isInternal ? getEligibilityChecklist(profile, scholarship) : null;
  const verdict = checklist ? VERDICTS[checklist.verdict] : null;
  const VerdictIcon = verdict?.icon;
  const requirements = isInternal ? getScholarshipRequirements(scholarship, profile) : [];
  const coverage = guide?.coverage || [scholarship.coverage].filter(Boolean);
  const firstMissing = profileGate.missing[0];
  const firstMissingSection = firstMissing?.section;
  const [documentsOpen, setDocumentsOpen] = useState(false);

  return (
    <article className="grid min-w-0 grid-rows-subgrid rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur" style={{ gridRow: `span ${CARD_SLOT_ROWS + checklistRows}` }}>
      <header className="flex items-start gap-3">
        <ScholarshipTrackIcon ruleFamily={getInternalRuleFamily(scholarship)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{guide?.kind || scholarship.category}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${DEADLINE_TONES[deadline.tone] || DEADLINE_TONES.neutral}`}>{deadline.label}</span>
          </div>
          <h3 className="mt-2 text-lg font-bold leading-snug text-app-text">{scholarship.title}</h3>
        </div>
      </header>

      {coverage.length > 0 ? (
        <div className="rounded-xl border border-app-border bg-app-surface p-3">
          <span className="text-xs font-bold uppercase tracking-wide text-app-muted">Coverage</span>
          {coverage.map((line) => <strong key={line} className="mt-1 block text-sm text-app-text">{line}</strong>)}
        </div>
      ) : <div />}

      {checklist ? (
        <>
          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${verdict.tone}`} role="status">
            <VerdictIcon size={22} className="shrink-0" aria-hidden="true" />
            <div className="grid min-w-0">
              <strong className="text-sm">{verdict.title}</strong>
              <span className="text-xs opacity-90">{verdictSummary(checklist)}</span>
            </div>
          </div>

          <EligibilityChecklist checklist={checklist} rowSpan={checklistRows} onOpenProfileSection={onOpenProfileSection} />

          {requirements.length > 0 ? (
            <button type="button" className="flex w-full items-center justify-between gap-2 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-left text-sm font-semibold text-app-text" onClick={() => setDocumentsOpen(true)} aria-haspopup="dialog">
              <span className="inline-flex items-center gap-2"><FileText size={15} aria-hidden="true" />Required documents ({requirements.length})</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : <div />}

          <div className="grid content-end gap-2">
            {documentsOpen && <RequiredDocumentsModal scholarship={scholarship} requirements={requirements} profile={profile} onClose={() => setDocumentsOpen(false)} />}
            {checklist.verdict === 'eligible' && profileGate.allowed && (
              <button type="button" className={primaryButton} onClick={() => onApply(scholarship)}>
                Start application
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
            {checklist.verdict === 'eligible' && !profileGate.allowed && firstMissingSection && onOpenProfileSection && (
              <button type="button" className={`${secondaryButton} w-full justify-center`} onClick={() => onOpenProfileSection(firstMissingSection, firstMissing.key)}>
                Finish your Application Form to apply
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
            {checklist.verdict !== 'eligible' && (
              <p className="m-0 text-center text-xs text-app-muted">Resolve the checks above to apply.</p>
            )}
            {applyError ? <p className="form-error m-0" role="alert">{applyError}</p> : null}
          </div>
        </>
      ) : (
        <>
          <div />
          <div style={{ gridRow: `span ${checklistRows}` }} />
          <div />
          <div className="grid content-end gap-2">
            <button type="button" className={primaryButton} onClick={() => onApply(scholarship)}>Track this program</button>
            {applyError ? <p className="form-error m-0" role="alert">{applyError}</p> : null}
          </div>
        </>
      )}
    </article>
  );
}

export default function ScholarshipExplorer({ profile, scholarships, searchQuery, filters, onSearchChange, onFilterChange, onApply, onOpenProfileSection }) {
  const [applyErrors, setApplyErrors] = useState({});
  const handleApply = async (scholarship) => {
    setApplyErrors((previous) => ({ ...previous, [scholarship.id]: '' }));
    const result = await onApply(scholarship);
    if (result && !result.allowed && result.reasons?.length) setApplyErrors((previous) => ({ ...previous, [scholarship.id]: result.reasons[0] }));
  };
  const resetFilters = () => {
    onSearchChange('');
    onFilterChange({ category: 'all', coverage: 'all', deadline: 'all', activeOnly: false });
  };
  const activeFilterCount = [filters.category, filters.coverage, filters.deadline].filter((value) => value !== 'all').length + (filters.activeOnly ? 1 : 0);
  // Profile first: an AdDU internal application can only be started once every
  // "Needed to apply" answer is complete. Browsing and the Smart Eligibility
  // Checker stay open.
  const profileGate = getApplicationProfileGate(profile);
  const missingSections = [...new Set(profileGate.missing.map((item) => item.section))];
  const internal = scholarships.filter(isAdduInternalProgram);
  const checklists = internal.map((scholarship) => getEligibilityChecklist(profile, scholarship));
  const qualifiedCount = checklists.filter((checklist) => checklist.verdict === 'eligible').length;
  // Every card reserves as many checklist rows as the longest checklist.
  const checklistRows = Math.max(1, ...checklists.map((checklist) => checklist.rows.length));

  return (
    <div className="grid gap-4">
      <section className="explorer-filters grid gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="page-title-copy">
            <span className="page-section-label">Scholarship Explorer</span>
            <h2>Check your eligibility</h2>
          </div>
          {internal.length > 0 && (
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${qualifiedCount ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-app-border bg-app-surface text-app-muted'}`}>
              <CheckCircle2 size={16} aria-hidden="true" />
              You qualify for {qualifiedCount} of {internal.length}
            </span>
          )}
        </div>
        <label className="explorer-search-field">
          <span className="sr-only">Search scholarships</span>
          <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name, category, coverage, or origin" aria-label="Search scholarships" />
        </label>
        <div className="explorer-filter-toolbar">
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Category"
              value={filters.category}
              onChange={(value) => onFilterChange({ category: value })}
              options={[
                { value: 'all', label: 'All categories' },
                { value: 'Internal Endowment', label: 'Internal Endowment' },
                { value: 'Corporate & External', label: 'Corporate & External' },
                { value: 'State-Sponsored', label: 'State-Sponsored' },
                { value: 'Specialized Service', label: 'Specialized Service' },
              ]}
              idPrefix="explorer-category"
            />
          </div>
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Coverage"
              value={filters.coverage}
              onChange={(value) => onFilterChange({ coverage: value })}
              options={coverageTypes.map((item) => ({ value: item, label: item === 'all' ? 'All coverage' : item }))}
              idPrefix="explorer-coverage"
            />
          </div>
          <div className="explorer-filter-slot">
            <SelectPicker
              label="Deadline"
              value={filters.deadline}
              onChange={(value) => onFilterChange({ deadline: value })}
              options={[
                { value: 'all', label: 'Any deadline' },
                { value: 'open', label: 'Open only' },
                { value: 'urgent', label: 'Urgent only' },
                { value: 'closed', label: 'Closed only' },
              ]}
              idPrefix="explorer-deadline"
            />
          </div>
          <label className="explorer-active-only">
            <input type="checkbox" checked={filters.activeOnly} onChange={(event) => onFilterChange({ activeOnly: event.target.checked })} />
            Active only
          </label>
          {(activeFilterCount > 0 || searchQuery) && <button type="button" className="explorer-reset-button" onClick={resetFilters}>Clear filters</button>}
        </div>
        <p className="explorer-filter-caption" aria-live="polite">
          <span><strong>{scholarships.length}</strong> matching program{scholarships.length === 1 ? '' : 's'}{activeFilterCount ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : ''}</span>
          <span className="explorer-govgrant-chip">{profile.hasActiveGovernmentGrant ? 'Gov grant active' : 'No active gov grant'}</span>
        </p>
      </section>

      {!profileGate.allowed ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-amber-400/40 bg-amber-500/10 p-4" aria-label="Complete your Application Form to apply">
          <div className="grid gap-0.5">
            <strong className="text-sm text-app-text">Complete your Application Form to apply</strong>
            <span className="text-xs text-app-muted">{profileGate.missing.length} answer{profileGate.missing.length === 1 ? '' : 's'} missing</span>
          </div>
          {onOpenProfileSection ? (
            <div className="flex flex-wrap gap-2">
              {missingSections.map((section) => (
                <button key={section} type="button" className={secondaryButton} onClick={() => onOpenProfileSection(section, profileGate.missing.find((item) => item.section === section)?.key)}>
                  {PROFILE_SECTION_LABELS[section] || 'Application Form'}
                  <ArrowRight size={15} className="shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3" aria-label="Scholarships">
        {scholarships.length ? scholarships.map((scholarship) => (
          <ScholarshipCard
            key={scholarship.id}
            scholarship={scholarship}
            profile={profile}
            profileGate={profileGate}
            checklistRows={checklistRows}
            onApply={handleApply}
            onOpenProfileSection={onOpenProfileSection}
            applyError={applyErrors[scholarship.id]}
          />
        )) : <div className="xl:col-span-3"><EmptyState title="No scholarships match your filters" description="Try a broader search or fewer filters." action={<button type="button" className={secondaryButton} onClick={resetFilters}>Reset filters</button>} /></div>}
      </section>
    </div>
  );
}
