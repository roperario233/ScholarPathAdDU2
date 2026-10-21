import { ADMISSIONS_STAFF_EXCLUDED_STATUSES, getApplicationStatusLabel } from './constants';
import { areDocumentsReviewable, describeStatusActor } from './applicationRequirements';

// The Admissions Office workspace is split into one route per function
// (overview, application review, catalog management, results release, and
// announcements) and two accountability lanes: Staff prepare a case, the Head
// decides it. These selectors keep every derivation out of the pages so the
// queues, the overview metrics, and the dashboard count all read one source and
// can be unit-tested without a DOM.

const asList = (value) => (Array.isArray(value) ? value : []);

// Applications that still need a Staff or Department Chair action. It reads the
// same exclusion list as countApplicationsToReview(), so the overview, the
// review queue, and the dashboard can never show different numbers for the same
// data. Approval and release leave this queue for the Head's lane.
export const getReviewQueue = (applications = []) => asList(applications)
  .filter((entry) => !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status));

// SOP step 7: recommendations the Admissions Office Head approves.
export const getApprovalQueue = (applications = []) => asList(applications)
  .filter((entry) => entry.status === 'Recommended');

// Applications whose result can be released (SOP steps 7-8).
export const getReleaseQueue = (applications = []) => {
  const list = asList(applications);
  const approved = list.filter((entry) => entry.status === 'Approved');
  const released = list.filter((entry) => entry.status === 'Released');
  return { approved, released, all: [...approved, ...released] };
};

// A Pending Document Vault file only blocks a forward stage when an application
// actually relies on it; an unattached vault upload gates nothing
// (manuscript 3.3.3). Document Vault verification itself happens inside each
// application's review modal, so this is a count, not a separate review list.
export const getDocumentsAwaitingReview = (applications = [], documents = []) => {
  // Only applications that have reached the SOP verification stage can have
  // their files reviewed, so a Pending file attached to a Submitted or
  // Under Review application is not counted yet.
  const attachedDocumentIds = new Set(asList(applications)
    .filter((entry) => areDocumentsReviewable(entry.status))
    .flatMap((entry) => (Array.isArray(entry.attachedDocuments) ? entry.attachedDocuments : [])));
  return asList(documents).filter((entry) => (
    entry.verificationStatus === 'Pending' && attachedDocumentIds.has(entry.id)
  ));
};

// Catalog management through the Admissions Office is limited by the role and
// RLS to AdDU internal entries. Government-linked and external programs remain
// outside this path.
export const getInternalCatalogEntries = (scholarships = []) => asList(scholarships).filter((entry) => (
  entry.isExternal !== true
  && entry.category === 'Internal Endowment'
  && ['general-pool', 'honors', 'work-study'].includes(entry.ruleFamily)
));

// Prefer the append-only status log (the trustworthy actor), falling back to the
// browser-written timeline for rows that predate it, and to a single
// current-status row for an application with no recorded events at all.
export const getRecentApplicationActivity = (applications = [], limit = 5) => asList(applications)
  .flatMap((application) => {
    const log = Array.isArray(application.statusLog) ? application.statusLog : [];
    const timeline = Array.isArray(application.timeline) ? application.timeline : [];
    const events = log.length
      ? log.map((event) => ({
        id: event.id,
        stage: event.toStatus,
        note: event.reason || `Application moved to ${getApplicationStatusLabel(event.toStatus)}.`,
        actor: describeStatusActor(event, true),
        at: event.at,
      }))
      : timeline;
    return (events.length ? events : [{
      id: `current-${application.id}`,
      stage: application.status,
      note: `Application is currently ${getApplicationStatusLabel(application.status)}.`,
      actor: 'Application workspace',
      at: application.updatedAt,
    }]).map((event) => ({ ...event, application }));
  })
  .sort((left, right) => (
    new Date(right.at || right.application.updatedAt || 0) - new Date(left.at || left.application.updatedAt || 0)
  ))
  .slice(0, limit);

// The accepted-applicant export the Admissions Office downloads from the results
// release route.
export const buildAcceptedApplicantsReport = (applications = []) => {
  const lines = ['SCHOLARPATH ADDU — ACCEPTED APPLICANTS FOR THE ADMISSIONS OFFICE', ''];
  asList(applications).forEach((entry) => {
    lines.push(`${entry.studentName} · ${entry.scholarshipTitle} · ${getApplicationStatusLabel(entry.status)} · Reference ${entry.release?.reference || 'Pending release'}`);
  });
  return lines.join('\n');
};
