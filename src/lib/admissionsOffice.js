import { ADMISSIONS_STAFF_EXCLUDED_STATUSES, getApplicationStatusLabel } from './constants';
import { areDocumentsReviewable, describeStatusActor } from './applicationRequirements';
import { isAdduInternalProgram } from './eligibility';

// The Admissions Office workspace is split into one route per function
// (dashboard, application review, catalog management, results release, and
// announcements) and two accountability lanes: Staff prepare a case, the Head
// decides it. These selectors keep every derivation out of the pages so the
// queues, the dashboard metrics, and the review count all read one source and
// can be unit-tested without a DOM.

const asList = (value) => (Array.isArray(value) ? value : []);

// The tab the review modal opens on: the stage the application is currently
// sitting in, so the reviewer lands on the work that stage needs instead of
// always on Overview. A status with no dedicated tab (Submitted, Under Review,
// Recommended, Approved, Released, Rejected) opens on Overview, where the action
// bar carries that stage's move.
const REVIEW_STAGE_TABS = {
  'For Verification': 'documents',
  'For Endorsement': 'endorsement',
  Endorsed: 'interview',
  Interview: 'interview',
};

export const getReviewStageTab = (status) => REVIEW_STAGE_TABS[status] || 'overview';

// Applications that still need a Staff or Department Chair action. It reads the
// same exclusion list as countApplicationsToReview(), so the Dashboard and the
// review queue can never show different numbers for the same data. Approval and
// release leave this queue for the Head's lane.
export const getReviewQueue = (applications = []) => asList(applications)
  .filter((entry) => !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status));

// --- Case officers: the intake pool and the personal review queue -------------
// The Admissions Office works one shared intake pool. Opening a case joins the
// officer to it (public.application_case_officers), so a case can have several
// officers and none of them is an "owner". These selectors turn that roster into
// the two lists the workspace shows: what nobody has opened yet (the intake pool)
// and the cases the signed-in officer is working (the review queue).
const submissionTime = (application = {}) => {
  const value = application.submittedAt || application.updatedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

// First come, first served: the oldest submission first, with a stable tie-break
// so the pool never reshuffles between renders.
const byOldestSubmission = (left, right) => (
  (submissionTime(left) - submissionTime(right))
  || String(left?.id || '').localeCompare(String(right?.id || ''))
);

const isOpenCase = (entry) => Boolean(entry) && !ADMISSIONS_STAFF_EXCLUDED_STATUSES.includes(entry.status);

const activeOfficers = (caseOfficers = []) => asList(caseOfficers).filter((entry) => entry && !entry.leftAt);

const officerIdsByApplication = (caseOfficers = []) => {
  const map = new Map();
  activeOfficers(caseOfficers).forEach((entry) => {
    if (!entry.applicationId) return;
    if (!map.has(entry.applicationId)) map.set(entry.applicationId, new Set());
    map.get(entry.applicationId).add(entry.officerId || entry.officerName || entry.id);
  });
  return map;
};

// The active roster for one application, oldest join first.
export const getCaseOfficers = (caseOfficers = [], applicationId) => activeOfficers(caseOfficers)
  .filter((entry) => entry.applicationId === applicationId)
  .sort((left, right) => (
    (new Date(left.joinedAt || 0) - new Date(right.joinedAt || 0))
    || String(left.officerName || '').localeCompare(String(right.officerName || ''))
  ));

export const isCaseOfficer = (caseOfficers, applicationId, officerId) => Boolean(applicationId && officerId)
  && getCaseOfficers(caseOfficers, applicationId).some((entry) => entry.officerId === officerId);

// When the case was first opened by an officer, so the pool can report coverage.
export const getCaseOpenedAt = (caseOfficers = [], applicationId) => (
  getCaseOfficers(caseOfficers, applicationId)[0]?.joinedAt || null
);

// Every open application nobody has opened yet, oldest first. `Submitted` cases
// are the intake itself; a case that is further along but carries no active
// officer (recorded before the roster existed, or after the last officer left)
// stays here so it cannot be stranded.
export const getIntakePool = (applications = [], caseOfficers = []) => {
  const claimed = officerIdsByApplication(caseOfficers);
  return asList(applications)
    .filter((entry) => isOpenCase(entry) && !claimed.has(entry.id))
    .sort(byOldestSubmission);
};

// Open applications at least one officer has opened.
export const getTakenCases = (applications = [], caseOfficers = []) => {
  const claimed = officerIdsByApplication(caseOfficers);
  return asList(applications)
    .filter((entry) => isOpenCase(entry) && claimed.has(entry.id))
    .sort(byOldestSubmission);
};

// The pool's unclaimed cases that are already past submission. They are the ones
// most likely to need attention, so the intake page reports their count.
export const getUnclaimedInProgress = (applications = [], caseOfficers = []) => (
  getIntakePool(applications, caseOfficers).filter((entry) => entry.status !== 'Submitted')
);

// The signed-in officer's review queue. A case leaves it only when it reaches a
// stage outside the review scope (approval and release belong to the Head) or the
// officer leaves the case.
export const getMyReviewQueue = (applications = [], caseOfficers = [], officerId = '') => {
  if (!officerId) return [];
  const mine = new Set(activeOfficers(caseOfficers)
    .filter((entry) => entry.officerId === officerId)
    .map((entry) => entry.applicationId));
  return asList(applications)
    .filter((entry) => mine.has(entry.id) && isOpenCase(entry))
    .sort(byOldestSubmission);
};

// Officer workload for the Head's oversight card: how many open cases each active
// officer is working. Read-only; membership is still self-selected.
export const getOfficerWorkload = (applications = [], caseOfficers = []) => {
  const openIds = new Set(asList(applications).filter(isOpenCase).map((entry) => entry.id));
  const byOfficer = new Map();
  activeOfficers(caseOfficers).forEach((entry) => {
    if (!openIds.has(entry.applicationId)) return;
    const key = entry.officerId || entry.officerName || entry.id;
    const current = byOfficer.get(key) || {
      officerId: entry.officerId || '',
      officerName: entry.officerName || 'Admissions Office reviewer',
      officerRole: entry.officerRole || '',
      cases: 0,
    };
    current.cases += 1;
    byOfficer.set(key, current);
  });
  return [...byOfficer.values()]
    .sort((left, right) => (right.cases - left.cases) || left.officerName.localeCompare(right.officerName));
};

// Whole days since submission, for the first-come-first-served waiting age. Null
// when the application carries no usable date.
export const getSubmissionWaitDays = (application, today = new Date()) => {
  const start = submissionTime(application);
  if (!start) return null;
  const end = today instanceof Date ? today.getTime() : new Date(today).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
};

// The intake page's coverage facet. Unclaimed is the default: the work nobody has
// opened yet. With officers is how a taken application stays discoverable, and
// All open cases is the office's full workload.
export const INTAKE_POOL_COVERAGE = [
  { value: 'unclaimed', label: 'Unclaimed' },
  { value: 'with-officers', label: 'With officers' },
  { value: 'all', label: 'All open cases' },
];

export const INTAKE_POOL_SORTS = [
  { value: 'oldest', label: 'Oldest submission first' },
  { value: 'newest', label: 'Newest submission first' },
  { value: 'longest', label: 'Longest waiting' },
  { value: 'scholarship', label: 'Scholarship A–Z' },
];

export const INTAKE_POOL_STAGE_OPTIONS = [
  'Submitted',
  'Under Review',
  'For Verification',
  'For Endorsement',
  'Endorsed',
  'Interview',
];

export const DEFAULT_INTAKE_POOL_FILTERS = {
  coverage: 'unclaimed',
  stage: 'all',
  query: '',
  scholarshipId: 'all',
  department: 'all',
  waitingOverDays: 0,
  sort: 'oldest',
};

// The scholarships and departments that actually appear in the open cases, so the
// facets never offer an empty result.
export const getIntakePoolFacets = (applications = []) => {
  const scholarships = new Map();
  const departments = new Set();
  asList(applications).filter(isOpenCase).forEach((entry) => {
    if (entry.scholarshipId) scholarships.set(entry.scholarshipId, entry.scholarshipTitle || 'Scholarship');
    if (entry.studentDepartment) departments.add(entry.studentDepartment);
  });
  return {
    scholarships: [...scholarships.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    departments: [...departments].sort((left, right) => left.localeCompare(right)),
  };
};

// One filter pass over the open applications: coverage, stage, text, scholarship,
// department, waiting age, then the chosen sort. FCFS stays the default ordering.
export const filterIntakePool = (applications = [], caseOfficers = [], filters = {}, today = new Date()) => {
  const merged = { ...DEFAULT_INTAKE_POOL_FILTERS, ...(filters || {}) };
  const claimed = officerIdsByApplication(caseOfficers);
  const query = String(merged.query || '').trim().toLowerCase();
  const waitingOverDays = Number(merged.waitingOverDays) || 0;

  const list = asList(applications).filter((entry) => {
    if (!isOpenCase(entry)) return false;
    const hasOfficers = claimed.has(entry.id);
    if (merged.coverage === 'unclaimed' && hasOfficers) return false;
    if (merged.coverage === 'with-officers' && !hasOfficers) return false;
    if (merged.stage && merged.stage !== 'all' && entry.status !== merged.stage) return false;
    if (merged.scholarshipId && merged.scholarshipId !== 'all' && entry.scholarshipId !== merged.scholarshipId) return false;
    if (merged.department && merged.department !== 'all' && (entry.studentDepartment || '') !== merged.department) return false;
    if (waitingOverDays > 0) {
      const days = getSubmissionWaitDays(entry, today);
      if (days == null || days < waitingOverDays) return false;
    }
    if (query) {
      const haystack = [entry.studentName, entry.scholarshipTitle, entry.studentProgram, entry.studentDepartment]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sorters = {
    oldest: byOldestSubmission,
    newest: (left, right) => byOldestSubmission(right, left),
    longest: byOldestSubmission,
    scholarship: (left, right) => (
      String(left.scholarshipTitle || '').localeCompare(String(right.scholarshipTitle || ''))
      || byOldestSubmission(left, right)
    ),
  };

  return list.sort(sorters[merged.sort] || byOldestSubmission);
};

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

// The system tracks only the three Appendix A AdDU tracks: Grant-in-Aid (GIA),
// the Jubilee Scholarship Fund, and the Student Assistant (Working Scholars)
// Program. "In scope" is decided by the title, exactly as the student Explorer,
// the application gate, and public.is_addu_in_scope_track() decide it. A
// category/rule-family test would list every donor endowment seeded as
// `general-pool` and would hide the Student Assistant program, which the catalog
// stores under the `Specialized Service` category.
export const getInternalCatalogEntries = (scholarships = []) => asList(scholarships)
  .filter((entry) => entry.isExternal !== true && isAdduInternalProgram(entry));

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
