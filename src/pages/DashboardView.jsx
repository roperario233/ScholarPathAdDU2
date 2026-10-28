import { ArrowRight, CalendarClock, CheckCircle2, FileText, ListChecks } from 'lucide-react';
import ScholarshipTrackIcon from '../components/ScholarshipTrackIcon';
import { getDeadlineStatus, getScholarshipAcademicDisplay } from '../lib/eligibility';
import { fmtCurrency, fmtDate } from '../lib/formatters';
import { getStandingRequirements } from '../lib/profile';
import { APPLICATION_PERIODS, PRELIMINARY_REQUIREMENTS, getScholarshipGuideCards } from '../lib/scholarshipGuide';

// The live eligibility the catalog entry declares, shown after the leaflet
// criteria so the card never disagrees with the Smart Eligibility Checker.
const getCatalogCriteria = (scholarship, profile) => {
  if (!scholarship) return [];
  const academic = getScholarshipAcademicDisplay(profile, scholarship);
  return [
    academic && `${academic.credential === 'qpi' ? 'Annual QPI' : 'Senior high school general average'} of at least ${academic.floorLabel}`,
    scholarship.maximumIncome != null && `Annual household income of up to ${fmtCurrency(scholarship.maximumIncome)}`,
  ].filter(Boolean);
};

function SectionHeading({ icon: Icon, children }) {
  return (
    <h4 className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-app-muted">
      <Icon size={14} aria-hidden="true" />
      {children}
    </h4>
  );
}

function ScholarshipGuideCard({ card, profile, standingNote }) {
  const criteria = [...card.criteria, ...getCatalogCriteria(card.scholarship, profile)];
  const deadline = card.scholarship?.deadline;
  const deadlineStatus = deadline ? getDeadlineStatus(deadline) : null;
  // Six sections (header, summary, coverage, who can apply, documents, deadline)
  // on a subgrid of the page grid, so each section lines up across the cards.
  return (
    <article className="row-span-6 grid min-w-0 grid-rows-subgrid rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur">
      <header className="flex items-start gap-3">
        <ScholarshipTrackIcon ruleFamily={card.ruleFamily} />
        <div className="min-w-0">
          <span className="eyebrow">{card.kind}</span>
          <h3 className="mt-2 text-lg font-bold text-app-text">{card.name}</h3>
        </div>
      </header>

      <p className="m-0 text-sm text-app-muted">{card.summary}</p>

      <div className="rounded-xl border border-app-border bg-app-surface p-3">
        <span className="text-xs font-bold uppercase tracking-wide text-app-muted">Coverage</span>
        {card.coverage.map((line) => <strong key={line} className="mt-1 block text-sm text-app-text">{line}</strong>)}
      </div>

      <div className="grid gap-2">
        <SectionHeading icon={CheckCircle2}>Who can apply</SectionHeading>
        <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-app-text">
          {criteria.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>

      <div className="grid gap-2">
        <SectionHeading icon={FileText}>Documents to submit</SectionHeading>
        <p className="m-0 text-xs text-app-muted">{standingNote}</p>
        <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-app-text">
          {card.requirements.map((item) => <li key={item.id}>{item.label}</li>)}
        </ul>
      </div>

      <p className="mb-0 self-end border-t border-app-border pt-3 text-xs text-app-muted">
        {deadline
          ? <>Deadline <strong className="text-app-text">{fmtDate(deadline)}</strong> · {deadlineStatus.label}</>
          : 'Deadline to be announced by the Office of Admission and Aid'}
      </p>
    </article>
  );
}

// The student Dashboard: the three AdDU internal grants first, each with its
// explanation and requirements, then one action into Scholarship Explorer.
// Staff, head, and Department Chair roles have their own landing workspaces (the
// Admissions Office Dashboard and Department Review), so this page is never
// rendered for them.
export default function DashboardView({ profile, isFirstLogin, scholarships, onOpenExplorer }) {
  if (profile.role !== 'student') return null;

  const cards = getScholarshipGuideCards(scholarships, profile);
  const standing = getStandingRequirements(profile);
  const standingNote = !standing.yearStanding
    ? 'Documents every applicant submits. Set your year standing in your Application Form to see the rest.'
    : standing.isIncomingFirstYear
      ? 'For incoming first-year applicants.'
      : 'For current Ateneo students and transferees.';

  return (
    <div className="grid gap-4">
      <section className="page-title-bar rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="page-title-copy">
          <span className="page-section-label">{isFirstLogin ? 'Welcome' : `Welcome back, ${profile.fullName || 'Scholar'}`}</span>
          <h2>Available AdDU scholarship grants</h2>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">The Office of Admission and Aid offers three financial aid pipelines. Read what each one covers and what to prepare before you apply.</p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3" aria-label="Scholarship grants">
        {cards.map((card) => <ScholarshipGuideCard key={card.ruleFamily} card={card} profile={profile} standingNote={standingNote} />)}
      </section>

      <section className="grid gap-5 rounded-app border border-app-border bg-app-card p-5 shadow-app md:grid-cols-2">
        <div className="grid gap-2">
          <SectionHeading icon={ListChecks}>Every applicant must</SectionHeading>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-app-text">
            {PRELIMINARY_REQUIREMENTS.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
        <div className="grid gap-2">
          <SectionHeading icon={CalendarClock}>Application period</SectionHeading>
          <ul className="m-0 grid gap-1 text-sm text-app-text">
            {APPLICATION_PERIODS.map((period) => <li key={period.label}><strong>{period.label}:</strong> {period.detail}</li>)}
          </ul>
          <p className="m-0 text-xs text-app-muted">All schedules are subject to change without prior notice.</p>
        </div>
      </section>

      {/* The page's one action: a navy banner with a white button. The button
          carries `hero-action` so the blue-action-view palette leaves it alone. */}
      <section className="relative overflow-hidden rounded-app bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright p-6 text-white shadow-app sm:p-8">
        <span className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-28 left-1/4 h-60 w-60 rounded-full bg-sky-400/20 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Smart Eligibility Checker</span>
            <h3 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-3xl">Ready to find the grant that fits you?</h3>
            <p className="mt-2 max-w-xl text-sm text-white/85 sm:text-base">Compare the three grants against your Application Form answers, then start your application from the scholarship page.</p>
          </div>
          <button
            type="button"
            className="hero-action group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-center text-base font-bold text-ateneo shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-blue-50 xl:w-auto"
            onClick={onOpenExplorer}
          >
            Explore scholarships and check your eligibility
            <ArrowRight className="shrink-0 transition group-hover:translate-x-1" size={20} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
