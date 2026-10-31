// A compact one-line flag shown to the Admissions Office Admin wherever they can
// step into a move that Consultation 2 gives to the interviewers or the school's
// approving level. The Admin's override stays available; this only says it is not
// the intended flow.
export default function AdminOverrideNotice({ children, className = '' }) {
  return (
    <p
      className={`m-0 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-snug text-amber-800 dark:text-amber-100 ${className}`}
      role="note"
    >
      <strong>Admin override — not the intended flow.</strong>
      {children ? <>{' '}{children}</> : null}
    </p>
  );
}
