import { describeGrantAmount } from '../lib/grantAmount';

// The Admin's "Mark final check as done" tick for one approved case. It is shared by
// the Final check and release list and the review modal's footer, so both read and
// write the same state. The tick stays locked until the grant amount is recorded.
// `showHint` is off in the review modal, whose footer states the same facts in its own
// note and muted-line pattern above the action row.
export default function FinalCheckToggle({ checked, grant, onChange, className = '', showHint = true }) {
  const unlocked = Boolean(grant);
  return (
    <div className={`grid min-w-0 gap-1 ${className}`}>
      <label
        className={`flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition focus-within:ring-2 focus-within:ring-blue-500/40 ${unlocked ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'} ${checked ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : `border-app-border bg-app-surface text-app-text ${unlocked ? 'hover:bg-app-card' : ''}`}`}
      >
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
          checked={checked}
          disabled={!unlocked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {checked ? 'Final check done' : 'Mark final check'}
      </label>
      {showHint ? (
        <span className={`text-xs ${unlocked ? 'text-app-muted' : 'text-amber-700 dark:text-amber-300'}`}>
          {unlocked ? `Grant amount: ${describeGrantAmount(grant)}` : 'Set the grant amount before the final check.'}
        </span>
      ) : null}
    </div>
  );
}
