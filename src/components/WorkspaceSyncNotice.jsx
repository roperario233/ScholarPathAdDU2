import { Button } from './ui';
import { describeSyncError } from '../lib/errorKinds';

// Shown above the page while the background refresh is failing. The data on
// screen is the last copy that loaded; this says so and lets the person retry.
export default function WorkspaceSyncNotice({ sync, onRetry, historyLoading = false }) {
  if (sync?.status !== 'stale') {
    if (!historyLoading) return null;
    // The status history, internal notes and panel notes of every case load just
    // after the first screen; the figures built from them complete when they land.
    return (
      <p className="m-0 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-muted" role="status" aria-live="polite">
        Case history is still loading. Figures that depend on it will complete in a moment.
      </p>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100"
      role="status"
      aria-live="polite"
    >
      <span>{describeSyncError(sync.kind)}</span>
      {onRetry ? <Button type="button" variant="secondary" onClick={onRetry}>Retry now</Button> : null}
    </div>
  );
}
