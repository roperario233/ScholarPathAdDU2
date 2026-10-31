import { describeStatusActor } from './applicationRequirements';

// Endorsement is SOP step 4: the Admissions Office Staff hand a fully verified
// application to the Admissions Office Admin, who records the decision. The
// Department Chair keeps read-only department visibility. The review modal's
// Endorsement tab only needs the hand-off/decision record, the internal
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

export const findStageEvent = (application, stage) => {
  const logged = [...stageEvents(application)].reverse().find((event) => event.stage === stage);
  if (logged) return logged;
  // A status change is written to the browser timeline before the append-only
  // status log reaches the next workspace load. Fall back to that timeline event
  // so the hand-off or decision recorded in this session stays readable.
  const log = asList(application?.statusLog);
  if (!log.length) return null;
  return [...asList(application?.timeline)].reverse().find((event) => event.stage === stage) || null;
};

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

// --- The Admin's SOP step-4 queue ---------------------------------------------
// A hand-off is the only way into the endorsement stage, so the queue is ordered
// by that event (oldest first) rather than by the status-change time. An
// application that predates the append-only status log falls back to its
// updatedAt, exactly as getEndorsementAgeDays() does.
const eventTime = (value) => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const handoffTime = (application) => eventTime(
  getEndorsementHandoff(application)?.at || application?.updatedAt,
);

const decisionTime = (application) => eventTime(
  getEndorsementDecisionEvent(application)?.at
  || application?.endorsement?.decidedAt
  || application?.updatedAt,
);

const byId = (left, right) => String(left?.id || '').localeCompare(String(right?.id || ''));

// The cases the Admissions Office Staff handed over that still await the Admin's
// decision, first come first served, with a stable tie-break so the list never
// reshuffles between renders.
export const getEndorsementQueue = (applications = []) => asList(applications)
  .filter((entry) => entry?.status === 'For Endorsement')
  .sort((left, right) => (handoffTime(left) - handoffTime(right)) || byId(left, right));

// The endorsement trail: cases the Admin already decided (SOP step 4 complete),
// newest decision first. The recorded note and reviewer live on
// applications.endorsement, which the Endorsement tab renders read-only.
export const getEndorsedApplications = (applications = []) => asList(applications)
  .filter((entry) => entry?.status === 'Endorsed')
  .sort((left, right) => (decisionTime(right) - decisionTime(left)) || byId(left, right));
