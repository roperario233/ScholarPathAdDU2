// Display labels for the stored application statuses, shared by the web app,
// the vitest suite, and the notification Edge Functions (plain JavaScript so
// Deno, Node, and the Vite bundle can all import it).
//
// Only `Endorsed` and `For Endorsement` differ from their stored values. Since
// Consultation 2 the Admissions Office Head forwards a verified case straight to
// the interviewers of its scope, so `Endorsed` is the stage where the case waits
// for its interview and is shown as "For Interview". `For Endorsement` only
// remains on rows handed off before that change. Keep the stored values
// untouched — the status check constraint, the RLS policies, and the
// append-only status log all read them.
export const APPLICATION_STATUS_LABELS = {
  Endorsed: 'For Interview',
  'For Endorsement': 'Awaiting Endorsement',
};

export const getApplicationStatusLabel = (status) => APPLICATION_STATUS_LABELS[status] || status;
