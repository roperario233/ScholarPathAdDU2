// What a stage move did, phrased once for the staff review surface and the list
// it returns to. A move used to close the review modal (or jump to another tab)
// without saying where the case went; this is the single description of the
// result: the new stage, who holds the case now, and what happens next.
//
// `goTab` names the review-modal tab that holds the next stage's work; a move
// with one continues in the modal on that tab, a move without one hands the
// case on.
//
// Staff-facing only. A rejection reason is never part of it, so nothing here can
// leak the staff-only reason, and the student copy stays in
// getApplicationStatusGuidance().
import { getApplicationStatusLabel } from './constants';
import { REVIEW_ROLE_LABELS } from './reviewScope';
import { formatInterviewWhen } from './interview';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const OUTCOMES = {
  'For Verification': ({ totalFiles }) => ({
    tone: 'info',
    title: 'Continued to verification',
    holder: 'With the Admissions Office Admin for document verification.',
    next: totalFiles
      ? `Next: verify the ${plural(totalFiles, 'attached file')}. The case can be forwarded to interview once every file is Verified.`
      : 'No files are attached, so the case can be forwarded to interview next.',
    goTab: totalFiles ? 'documents' : null,
  }),
  // The hand-off retired by Consultation 2; a legacy case can still record it.
  'For Endorsement': () => ({
    tone: 'info',
    title: 'Sent for endorsement',
    holder: 'With the Admissions Office Admin.',
    next: 'The Admin records the endorsement decision next.',
    goTab: 'endorsement',
  }),
  Endorsed: ({ school }) => ({
    tone: 'info',
    title: 'Forwarded to interview',
    holder: `With the interviewers of ${school || "the applicant's school"}.`,
    next: 'They schedule the interview next. The applicant is notified once it is set.',
    goTab: 'interview',
  }),
  Interview: ({ interview }) => ({
    tone: 'info',
    title: 'Interview scheduled',
    holder: 'With the interview panel.',
    next: interview?.startsAt
      ? `${formatInterviewWhen(interview.startsAt, interview.durationMinutes)}. The applicant and the panel were notified.`
      : 'The applicant and the panel were notified.',
    goTab: 'interview',
  }),
  Recommended: ({ approverRole }) => ({
    tone: 'info',
    title: 'Recommended for approval',
    holder: `With the school's ${REVIEW_ROLE_LABELS[approverRole] || 'approving level'}.`,
    next: 'They approve or reject the recommendation next.',
    goTab: null,
  }),
  Approved: () => ({
    tone: 'success',
    title: 'Approved',
    holder: 'With the Admissions Office Admin for the final check.',
    next: 'The result is released with its scholarship from Final check and release. Until then the student sees “Under deliberation”.',
    goTab: null,
  }),
  Rejected: () => ({
    tone: 'neutral',
    title: 'Not accepted',
    holder: 'Closed. The reason is saved in the internal notes.',
    next: 'The student receives only the general notice, never the reason, once the results are released.',
    goTab: null,
  }),
  Released: () => ({
    tone: 'success',
    title: 'Result released',
    holder: 'Released to the student.',
    next: 'No further stage follows.',
    goTab: null,
  }),
};

/**
 * @returns {null | {
 *   applicationId: string, studentName: string, scholarshipTitle: string,
 *   fromStatus: string, toStatus: string, fromLabel: string, toLabel: string,
 *   tone: string, title: string, holder: string, next: string,
 *   goTab: string | null, warning: string,
 * }}
 */
export const describeStageOutcome = ({
  application = {},
  fromStatus = '',
  toStatus = '',
  approverRole = '',
  interview = null,
  totalFiles = 0,
  warning = '',
} = {}) => {
  const build = OUTCOMES[toStatus];
  if (!build) return null;
  const detail = build({
    school: application.studentSchool || '',
    approverRole,
    interview: interview || application.interview || null,
    totalFiles: Number(totalFiles) || 0,
  });
  const toLabel = getApplicationStatusLabel(toStatus);
  return {
    applicationId: application.id || '',
    studentName: application.studentName || 'The applicant',
    scholarshipTitle: application.scholarshipTitle || '',
    fromStatus,
    toStatus,
    fromLabel: fromStatus ? getApplicationStatusLabel(fromStatus) : '',
    toLabel,
    ...detail,
    warning: String(warning || '').trim(),
  };
};
