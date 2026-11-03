import { useEffect, useRef } from 'react';
import { ArrowRight, CheckCircle2, CircleSlash, TriangleAlert, X } from 'lucide-react';
import { Button, StatusBadge } from './ui';

const TONE_STYLES = {
  success: 'border-emerald-400/40 bg-emerald-500/10',
  info: 'border-sky-400/40 bg-sky-500/10',
  neutral: 'border-app-border bg-app-surface',
};

const BADGE_TONES = { success: 'success', info: 'info', neutral: 'neutral' };

// The result of a stage move that hands the case on (Recommend, Approve,
// Reject), shown in place of the review modal's tab panel: what changed, who
// holds the case now, and what happens next. It replaces the silent close that
// used to follow such a move. A move whose next work stays in the modal lands on
// that tab under a StageMoveStrip instead. `describeStageOutcome()`
// (src/lib/stageOutcome.js) supplies every line.
export default function StageOutcomeCard({ outcome, onDone }) {
  const headingRef = useRef(null);
  // The action button that ran the move no longer exists (the footer changes
  // with the stage), so focus moves to the result instead of being lost.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [outcome]);

  if (!outcome) return null;
  const Icon = outcome.tone === 'neutral' ? CircleSlash : CheckCircle2;
  return (
    <section
      className={`stage-outcome-enter grid content-start gap-4 rounded-2xl border p-4 sm:p-5 ${TONE_STYLES[outcome.tone] || TONE_STYLES.info}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon size={22} aria-hidden="true" className={`mt-0.5 shrink-0 ${outcome.tone === 'neutral' ? 'text-app-muted' : outcome.tone === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-sky-600 dark:text-sky-300'}`} />
        <div className="grid min-w-0 gap-1">
          <h4 ref={headingRef} tabIndex={-1} className="m-0 text-base font-bold text-app-text focus:outline-none">{outcome.title}</h4>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-app-muted">
            {outcome.fromLabel ? <StatusBadge tone="neutral">{outcome.fromLabel}</StatusBadge> : null}
            {outcome.fromLabel ? <ArrowRight size={14} aria-label="to" /> : null}
            <StatusBadge tone={BADGE_TONES[outcome.tone] || 'info'}>{outcome.toLabel}</StatusBadge>
          </div>
        </div>
      </div>

      <dl className="m-0 grid gap-2 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Now</dt>
          <dd className="m-0 text-app-text">{outcome.holder}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">Next</dt>
          <dd className="m-0 text-app-text">{outcome.next}</dd>
        </div>
      </dl>

      {outcome.warning ? (
        <p className="m-0 flex items-start gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100" role="note">
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0">{outcome.warning}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="primary" onClick={onDone}>Done</Button>
      </div>
    </section>
  );
}

// A move whose next work stays in the modal opens that tab; this one line on top
// of it says why the tab changed. Dismissible, and gone once another tab opens.
export function StageMoveStrip({ outcome, onDismiss }) {
  if (!outcome) return null;
  return (
    <div
      className="stage-outcome-enter mb-3 flex min-w-0 shrink-0 items-start gap-2 rounded-[14px] border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm text-app-text"
      role="status"
    >
      <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-300" />
      <p className="m-0 min-w-0 flex-1">
        <strong>{outcome.title}.</strong> {outcome.holder} {outcome.next}
        {outcome.warning ? <span className="mt-1 block text-amber-800 dark:text-amber-100">{outcome.warning}</span> : null}
      </p>
      <button
        type="button"
        className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-lg text-app-muted transition hover:bg-black/5 hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
        onClick={onDismiss}
        aria-label="Dismiss stage change message"
      >
        <X size={14} />
      </button>
    </div>
  );
}
