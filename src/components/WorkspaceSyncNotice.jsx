import { Button } from './ui';
import { describeSyncError } from '../lib/errorKinds';

// Shown above the page while the background refresh is failing. The data on
// screen is the last copy that loaded; this says so and lets the person retry.
export default function WorkspaceSyncNotice({ sync, onRetry }) {
  if (sync?.status !== 'stale') return null;
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
