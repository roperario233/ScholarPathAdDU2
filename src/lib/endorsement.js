import { describeStatusActor } from './applicationRequirements';

// Endorsement is SOP step 4: the Admissions Office hands a fully verified
// application to the Department Chair, who records one decision. The review
// modal's Endorsement tab only needs the hand-off/decision record, the internal
// comments, and the timing; stage authority still lives in App.jsx.

// Advisory only: it highlights a case that has waited, but never blocks it.
export const ENDORSEMENT_SLA_DAYS = 5;

export const ENDORSEMENT_NOTE_PRESETS = [
  'Meets the academic and income criteria.',
  'Documents are verified and consistent with the submission.',
  'Endorsed with a maintained-QPI condition.',
];

const asList = (value) => (Array.isArray(value) ? value : []);

// The append-only status log is the trustworthy record; the browser timeline is
// the fallback for applications that predate it.
const stageEvents = (application) => {
  const log = asList(application?.statusLog);
  if (log.length) {
    return log.map((event) => ({
      id: event.id,
      stage: event.toStatus,
      at: event.at,
      actor: describeStatusActor(event, true),
      note: event.reason || '',
    }));
  }
  return asList(application?.timeline);
};

export const findStageEvent = (application, stage) => (
  [...stageEvents(application)].reverse().find((event) => event.stage === stage) || null
);

export const getEndorsementHandoff = (application) => findStageEvent(application, 'For Endorsement');
export const getEndorsementDecisionEvent = (application) => findStageEvent(application, 'Endorsed');

const dayDiff = (from, to) => {
  const start = new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
};

// Days spent at the hand-off, waiting for the Chair, or between hand-off and
// decision. Used for the small timing line in the endorsement record.
export const getEndorsementAgeDays = (application, today = new Date()) => {
  if (!application) return null;
  const handoff = getEndorsementHandoff(application);
  const decision = getEndorsementDecisionEvent(application);
  if (application.status === 'For Endorsement') {
    return dayDiff(handoff?.at || application.updatedAt, today);
  }
  if (application.status === 'Endorsed' || application.endorsement) {
    return dayDiff(
      handoff?.at || application.updatedAt,
      decision?.at || application.endorsement?.decidedAt || today,
    );
  }
  const verification = findStageEvent(application, 'For Verification');
  return dayDiff(verification?.at || application.updatedAt, today);
};

export const isEndorsementOverdue = (application, today = new Date()) => (
  application?.status === 'For Endorsement'
  && (getEndorsementAgeDays(application, today) ?? 0) > ENDORSEMENT_SLA_DAYS
);

// The internal thread for one application, oldest first.
export const getApplicationComments = (reviewComments = [], applicationId) => (
  asList(reviewComments)
    .filter((comment) => comment.applicationId === applicationId)
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0))
);
