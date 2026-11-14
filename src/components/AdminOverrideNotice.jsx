// A compact one-line flag shown to the Admissions Office Admin wherever they can
// step into a move that Consultation 2 gives to the interviewers or the school's
// approving level. The Admin's override stays available; this only says it is not
// the intended flow.
//
// A Dean or Assistant Dean who may decide a recommendation in place of the school's
// configured approver gets the same flag with its own `label`.
export default function AdminOverrideNotice({ children, className = '', label = 'Admin override — not the intended flow.' }) {
  return (
    <p
      className={`m-0 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-snug text-amber-800 dark:text-amber-100 ${className}`}
      role="note"
    >
      <strong>{label}</strong>
      {children ? <>{' '}{children}</> : null}
    </p>
  );
}
