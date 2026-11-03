import { useEffect, useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';

const SPOTLIGHT_MS = 2200;

const findRow = (applicationId) => {
  if (typeof document === 'undefined' || !applicationId) return null;
  const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(applicationId) : applicationId;
  return document.querySelector(`[data-application-id="${id}"]`);
};

// Glows the row carrying `data-application-id` for a moment and scrolls it into
// view. Returns a cleanup, or null when no such row is on screen.
export function spotlightRow(applicationId, { onDone } = {}) {
  const row = findRow(applicationId);
  if (!row) return null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  row.classList.add('row-spotlight');
  const timer = window.setTimeout(() => {
    row.classList.remove('row-spotlight');
    onDone?.();
  }, SPOTLIGHT_MS);
  return () => {
    window.clearTimeout(timer);
    row.classList.remove('row-spotlight');
  };
}

// What a page does after the shared review modal closes on a stage move. The
// modal passes `{ outcome }` (describeStageOutcome) to `onClose`. When the case is
// still listed on the page, its row glows for a moment so the eye finds it; when
// the move took it off the list, a banner says where it went instead of the row
// silently disappearing. Rows opt in with `data-application-id`.
//
//   const moved = useMovedCase(visibleIds);
//   <MovedCaseNotice notice={moved.notice} onDismiss={moved.dismiss} />
//   <ApplicationReviewModal onClose={(result) => { close(); moved.handleClose(result); }} />
export function useMovedCase(visibleIds = []) {
  const [moved, setMoved] = useState(null);
  const listed = Boolean(moved) && visibleIds.includes(moved.applicationId);

  useEffect(() => {
    if (!moved || !listed || moved.spotlit || moved.forceNotice) return undefined;
    const cleanup = spotlightRow(moved.applicationId, {
      onDone: () => setMoved((current) => (current?.stamp === moved.stamp ? null : current)),
    });
    if (!cleanup) {
      // Listed but not on screen (a page section that is not rendered): say
      // where it went rather than point at nothing.
      setMoved((current) => (current ? { ...current, forceNotice: true } : current));
      return undefined;
    }
    return cleanup;
  }, [moved, listed]);

  return {
    notice: moved && (!listed || moved.forceNotice) ? moved : null,
    dismiss: () => setMoved(null),
    // Pass the review modal's close result straight through. A close without a
    // move clears any earlier notice.
    handleClose: (result) => {
      setMoved(result?.outcome ? { ...result.outcome, stamp: Date.now() } : null);
    },
  };
}

export default function MovedCaseNotice({ notice, onDismiss, offListNote = 'It no longer appears in this list.' }) {
  if (!notice) return null;
  return (
    <div
      className="stage-outcome-enter flex min-w-0 items-start justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-100"
      role="status"
    >
      <ArrowRightLeft size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="m-0 min-w-0 flex-1">
        <strong>{notice.studentName}</strong>
        {notice.scholarshipTitle ? ` · ${notice.scholarshipTitle}` : ''}
        {` moved to ${notice.toLabel}. ${notice.holder}`}
        {notice.forceNotice || !offListNote ? '' : ` ${offListNote}`}
      </p>
      <button
        type="button"
        className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-current transition hover:bg-black/5 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
        onClick={onDismiss}
        aria-label="Dismiss stage change message"
      >
        <X size={16} />
      </button>
    </div>
  );
}
