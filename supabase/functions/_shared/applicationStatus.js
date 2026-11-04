// Display labels for the stored application statuses, shared by the web app,
// the vitest suite, and the notification Edge Functions (plain JavaScript so
// Deno, Node, and the Vite bundle can all import it).
//
// Since Consultation 2 the Admissions Office Admin forwards a verified case
// straight to the interviewers of its scope, so `Endorsed` is the stage where
// the case waits for its interview and is shown as "For Interview".
// `For Endorsement` only remains on rows handed off before that change.
//
// The office asked that no one read the word "reject" on an application, so the
// stored `Rejected` value is shown as "Not accepted" on every surface, staff and
// student alike. Keep the stored values untouched — the status check
// constraint, the RLS policies, and the append-only status log all read them.
export const APPLICATION_STATUS_LABELS = {
  Endorsed: 'For Interview',
  'For Endorsement': 'Awaiting Endorsement',
  Rejected: 'Not accepted',
};

export const getApplicationStatusLabel = (status) => APPLICATION_STATUS_LABELS[status] || status;

// What a student reads for their own application. A released `Released` result
// is the acceptance, and `Declined` is the student's own answer to an offer or
// the waitlist. The student-only display values set by the results hold
// ("Under deliberation", "Processed") pass through unchanged.
export const STUDENT_APPLICATION_STATUS_LABELS = {
  ...APPLICATION_STATUS_LABELS,
  Released: 'Accepted',
};

export const getStudentApplicationStatusLabel = (status) => STUDENT_APPLICATION_STATUS_LABELS[status] || status;
