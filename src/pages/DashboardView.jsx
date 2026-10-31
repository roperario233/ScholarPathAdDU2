import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CalendarClock, CheckCircle2, ChevronRight, FileText, ListChecks, Sparkles } from 'lucide-react';
import ScholarshipTrackIcon from '../components/ScholarshipTrackIcon';
import { ModalShell } from '../components/ui';
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

// The header greets by time of day; the student's name already sits in the sidebar.
const getGreeting = (now = new Date()) => {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const countPrograms =(programs) => programs.reduce((total, group) => total + group.names.length, 0);

// The programs a track admits, as the leaflet prints them, in a dialog portaled
// to <body>: the card's backdrop blur would otherwise trap the fixed overlay.
function ProgramsModal({ card, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <ModalShell title="WSP programs" onClose={onClose} className="flex w-[min(560px,100%)] max-h-[min(86vh,760px)] flex-col">
      <p className="m-0 text-sm text-app-muted">
        <strong className="text-app-text">{card.name}</strong> · Open only to the {countPrograms(card.programs)} programs below, as listed by the Office of Admission and Aid.
      </p>
      <div className="app-scroll mt-4 grid gap-3 overflow-y-auto">
        {card.programs.map((group) => (
          <section key={group.heading} className="rounded-xl border border-app-border bg-app-surface p-3">
            <h4 className="m-0 text-xs font-bold uppercase tracking-wide text-app-muted">{group.heading}</h4>
            <ul className="m-0 mt-2 grid list-disc gap-1 pl-5 text-sm text-app-text sm:grid-cols-2">
              {group.names.map((name) => <li key={name}>{name}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </ModalShell>,
    document.body,
  );
}

function ScholarshipGuideCard({ card, profile, standingNote }) {
  const [programsOpen, setProgramsOpen] = useState(false);
  const criteria = [...card.criteria, ...getCatalogCriteria(card.scholarship, profile)];
  const deadline = card.scholarship?.deadline;
  const deadlineStatus = deadline ? getDeadlineStatus(deadline) : null;
  // Six sections (header, summary, coverage, who can apply, documents, deadline)
  // on a subgrid of the page grid, so each section lines up across the cards.
  return (
    <article className="row-span-6 grid min-w-0 grid-rows-subgrid rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur">
      <header className="flex items-start gap-3">
        <ScholarshipTrackIcon ruleFamily={card.ruleFamily} />
        {/* flex-1: a global rule stops the last child of an article's flex row from
            shrinking, so without it a long title ("Working Scholar Program (WSP)")
            overflows the card instead of wrapping. */}
        <div className="min-w-0 flex-1">
          <span className="eyebrow">{card.kind}</span>
          <h3 className="mt-2 text-lg font-bold text-app-text">{card.name}</h3>
        </div>
      </header>

      <p className="m-0 text-sm text-app-muted">{card.summary}</p>

      <div className="rounded-xl border border-app-border bg-app-surface p-3">
        <span className="text-xs font-bold uppercase tracking-wide text-app-muted">Coverage</span>
        {card.coverage.map((line) => <strong key={line} className="mt-1 block text-sm text-app-text">{line}</strong>)}
      </div>

      {/* `content-start` keeps each section at its natural spacing when the
          subgrid row stretches to the tallest card in the row. */}
      <div className="grid content-start gap-2">
        <SectionHeading icon={CheckCircle2}>Who can apply</SectionHeading>
        <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-app-text">
          {criteria.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {card.programs && (
          // Styled as the card-surface row the list used to expand from:
          // `disclosure-action` keeps the blue-action-view palette off it, and
          // the surface is set as a token value because `button.bg-app-surface`
          // would repaint it as a tinted page action.
          <button
            type="button"
            className="disclosure-action flex w-full items-center gap-1.5 rounded-xl border border-app-border bg-[color:var(--surface)] px-3 py-2 text-left text-sm font-semibold text-app-text focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
            aria-haspopup="dialog"
            onClick={() => setProgramsOpen(true)}
          >
            <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
            WSP programs ({countPrograms(card.programs)})
          </button>
        )}
      </div>

      <div className="grid content-start gap-2">
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
      {programsOpen && <ProgramsModal card={card} onClose={() => setProgramsOpen(false)} />}
    </article>
  );
}

// The student Dashboard: the three AdDU internal grants first, each with its
// explanation and requirements, then one action into Scholarship Explorer.
// Staff, Admin, and Department Chair roles have their own landing workspaces (the
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
  // The soonest still-open deadline among the three grants, for the header tile.
  const nextDeadlineCard = cards
    .filter((card) => card.scholarship?.deadline && getDeadlineStatus(card.scholarship.deadline).remainingDays >= 0)
    .sort((a, b) => getDeadlineStatus(a.scholarship.deadline).remainingDays - getDeadlineStatus(b.scholarship.deadline).remainingDays)[0] || null;

  return (
    <div className="grid gap-4">
      {/* Same height as a plain title bar: the rail and glow are absolute, the
          standing chip shares the greeting's line, and the deadline tile sits
          beside the copy from `xl` only, so nothing stacks and adds height. */}
      <section className="page-title-bar relative rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-ateneo via-sky-400 to-cyan-300" aria-hidden="true" />
        <span className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-blue-500/15 blur-3xl" aria-hidden="true" />
        <div className="relative flex min-w-0 items-center justify-between gap-6">
          <div className="page-title-copy flex-1">
            <h2 className="flex min-w-0 items-center gap-2.5 !mt-0 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
              <Sparkles size={24} className="shrink-0 text-[color:var(--accent)]" aria-hidden="true" />
              <span className="min-w-0 truncate">{isFirstLogin ? 'Welcome, Scholar' : `${getGreeting()}, Scholar`}</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-app-muted"><strong className="font-semibold text-app-text">Available AdDU scholarship grants.</strong> The Office of Admission and Aid offers three financial aid pipelines. Read what each one covers and what to prepare before you apply.</p>
          </div>
          {nextDeadlineCard ? (
            <div className="hidden w-72 shrink-0 items-center gap-3 rounded-2xl border border-app-border bg-app-surface/70 p-3 xl:flex">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-200" aria-hidden="true"><CalendarClock size={18} /></span>
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-app-muted">Next deadline</span>
                <strong className="block truncate text-sm font-bold text-app-text" title={nextDeadlineCard.name}>{nextDeadlineCard.name}</strong>
                <span className="block truncate text-xs text-app-muted">{fmtDate(nextDeadlineCard.scholarship.deadline)} · {getDeadlineStatus(nextDeadlineCard.scholarship.deadline).label}</span>
              </div>
            </div>
          ) : null}
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
            <p className="mt-2 max-w-xl text-sm text-white/85">Compare the three grants to your answers, then apply from the scholarship page.</p>
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
