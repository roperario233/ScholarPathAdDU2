// Display labels for the stored application statuses, shared by the web app,
// the vitest suite, and the notification Edge Functions (plain JavaScript so
// Deno, Node, and the Vite bundle can all import it).
//
// Only `Endorsed` differs from its stored value: the database records the chair's
// decision as `Endorsed`, while every surface shows the Standard Procedure step-4
// phase the application is in. Keep the stored values untouched — the status
// check constraint, the department-chair RLS policies, and the append-only status
// log all read `Endorsed`.
export const APPLICATION_STATUS_LABELS = {
  Endorsed: 'Endorsement',
};

export const getApplicationStatusLabel = (status) => APPLICATION_STATUS_LABELS[status] || status;
