// A single-choice filter row shared by the Admissions Office pages. The chips are
// radio inputs under a styled label rather than buttons, because the authenticated
// shell paints every <button> as a page action and would flatten the active state.
// `count` is shown beside the label and `alert` tints it amber (work is waiting);
// `dotClass` marks the active chip with its own tone, like the calendar's marks.
export default function FilterChips({ name, legend, options = [], value, onChange, className = '' }) {
  return (
    <fieldset className={`m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0 ${className}`}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition peer-focus-visible:ring-4 peer-focus-visible:ring-blue-500/20 ${selected
                ? 'border-ateneo bg-ateneo text-white dark:border-sky-400 dark:bg-sky-400/20 dark:text-sky-100'
                : 'border-app-border bg-app-surface text-app-text hover:border-ateneo/50'}`}
            >
              {selected && option.dotClass ? (
                <span className={`h-2 w-2 rounded-full ${option.dotClass}`} aria-hidden="true" />
              ) : null}
              {option.label}
              {option.count != null ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${selected
                    ? 'bg-white/20 text-white'
                    : option.alert
                      ? 'bg-amber-400/20 text-amber-700 dark:text-amber-200'
                      : 'bg-app-card text-app-muted'}`}
                >
                  {option.count}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
