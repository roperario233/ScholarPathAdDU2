import { ADMISSIONS_STAFF_EXCLUDED_STATUSES, getApplicationStatusLabel } from './constants';
import { areDocumentsReviewable, describeStatusActor } from './applicationRequirements';
import { isAdduInternalProgram } from './eligibility';
import { findAcademicProgram } from './academicPrograms';
import { getReviewScopeLabel, getReviewerScope, isApplicationInReviewerScope, isInterviewerRole } from './reviewScope';

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
  school: 'all',
  department: 'all',
  waitingOverDays: 0,
  sort: 'oldest',
};

// The academic levels an applicant is filed under. `studentSchool` is the profile's
// stored school; the department comes from the degree program through the taxonomy,
// so the office can facet on either level (School -> Cluster -> Department -> Program).
const schoolOf = (entry = {}) => String(entry.studentSchool || '').trim();
const departmentOf = (entry = {}) => findAcademicProgram(entry.studentProgram)?.department || '';

// The scholarships, schools, and departments that actually appear in the open cases,
// so the facets never offer an empty result.
export const getIntakePoolFacets = (applications = []) => {
  const scholarships = new Map();
  const schools = new Set();
  const departments = new Set();
  asList(applications).filter(isOpenCase).forEach((entry) => {
    if (entry.scholarshipId) scholarships.set(entry.scholarshipId, entry.scholarshipTitle || 'Scholarship');
    const school = schoolOf(entry);
    if (school) schools.add(school);
    const department = departmentOf(entry);
    if (department) departments.add(department);
  });
  return {
    scholarships: [...scholarships.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    schools: [...schools].sort((left, right) => left.localeCompare(right)),
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
    if (merged.school && merged.school !== 'all' && schoolOf(entry) !== merged.school) return false;
    if (merged.department && merged.department !== 'all' && departmentOf(entry) !== merged.department) return false;
    if (waitingOverDays > 0) {
      const days = getSubmissionWaitDays(entry, today);
      if (days == null || days < waitingOverDays) return false;
    }
    if (query) {
      const haystack = [entry.studentName, entry.scholarshipTitle, entry.studentProgram, schoolOf(entry), departmentOf(entry)]
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
// the Jubilee Scholarship Fund, and the Working Scholar Program (WSP, formerly
// the Student Assistant Program). "In scope" is decided by the title, exactly as the student Explorer,
// the application gate, and public.is_addu_in_scope_track() decide it. A
// category/rule-family test would list every donor endowment seeded as
// `general-pool` and would hide the Working Scholar Program, which the catalog
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

// The applicant summary the office and finance work in (Consultation 2, #2): one
// row per application with the course, the year level, and the household income
// the student certified. Exported as CSV with a UTF-8 byte-order mark, which
// Excel opens directly, so no spreadsheet library is needed. Every value comes
// from the frozen profile snapshot (falling back to the loaded profile), which
// any role that can read the application already sees, so the export never
// depends on the office-only household-finance tables.
const APPLICANT_SUMMARY_COLUMNS = [
  ['Applicant', (entry) => entry.profileSnapshot?.fullName || entry.studentName || ''],
  ['Student number', (entry) => entry.profileSnapshot?.studentNumber || ''],
  ['School', (entry, ctx) => ctx.scope(entry).school || entry.studentSchool || ''],
  ['Cluster', (entry, ctx) => ctx.scope(entry).cluster || ''],
  ['Department', (entry, ctx) => ctx.scope(entry).department || ''],
  ['Program', (entry) => findAcademicProgram(entry.studentProgram)?.label || entry.studentProgram || ''],
  ['Year level', (entry) => entry.profileSnapshot?.yearStandingLabel || ''],
  ['Academic record', (entry) => {
    const academic = entry.profileSnapshot?.academic;
    if (academic?.value != null && academic.value !== '') return `${academic.label || 'Academic record'} ${academic.value}`;
    return entry.studentQpi != null && entry.studentQpi !== '' ? `QPI ${entry.studentQpi}` : '';
  }],
  ['Annual household income (PHP)', (entry) => {
    const value = entry.profileSnapshot?.householdIncome?.value ?? entry.studentHouseholdIncome;
    return value == null || value === '' ? '' : String(Number(value));
  }],
  ['Scholarship', (entry) => entry.scholarshipTitle || ''],
  ['Interview recommendation', (entry, ctx) => ctx.recommendation(entry)],
  ['Status', (entry) => getApplicationStatusLabel(entry.status)],
  ['Release reference', (entry) => entry.release?.reference || ''],
];

// Excel reads a UTF-8 CSV correctly only with a byte-order mark (U+FEFF).
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildApplicantSummaryCsv = (applications = [], { scopeOf, recommendationOf } = {}) => {
  const ctx = {
    scope: (entry) => (typeof scopeOf === 'function' ? scopeOf(entry) : null) || {},
    recommendation: (entry) => (typeof recommendationOf === 'function' ? recommendationOf(entry) : '') || '',
  };
  const rows = [
    APPLICANT_SUMMARY_COLUMNS.map(([label]) => label),
    ...asList(applications).map((entry) => APPLICANT_SUMMARY_COLUMNS.map(([, read]) => read(entry, ctx))),
  ];
  return `${BYTE_ORDER_MARK}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
};

// Saves the summary in the browser. Kept beside the builder so every page that
// offers the export names the file the same way.
export const downloadApplicantSummaryCsv = (applications, options = {}, fileName = 'Applicant_summary.csv') => {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([buildApplicantSummaryCsv(applications, options)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// The Head's final check before release (Consultation 2, #13): a sibling who is
// already on a grant, and another application of the same student that is still
// open. These are hints for the Head to read, not decisions.
const normalizeName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const parentNames = (entry) => {
  const family = entry?.profileSnapshot?.family || {};
  return [family.fatherName, family.motherName].map(normalizeName).filter(Boolean);
};

export const getFinalCheckHints = (application, applications = []) => {
  const list = asList(applications).filter((entry) => entry.id !== application?.id);
  const parents = new Set(parentNames(application));
  const siblingsOnGrant = parents.size
    ? list.filter((entry) => (
      entry.studentId !== application.studentId
      && ['Approved', 'Released'].includes(entry.status)
      && parentNames(entry).some((name) => parents.has(name))
    ))
    : [];
  const pendingCases = list.filter((entry) => (
    entry.studentId === application?.studentId
    && !['Draft', 'Released', 'Rejected'].includes(entry.status)
  ));
  return { siblingsOnGrant, pendingCases, selfDeclaredSibling: Boolean(application?.profileSnapshot?.eligibility?.hasSiblingOnAid) };
};

// Approved and released applications grouped by scholarship, for the batch
// release: the Head releases one scholarship's results to every applicant at the
// same time.
export const getReleaseGroups = (applications = [], scholarships = [], resultsReleases = []) => {
  const titleById = Object.fromEntries(asList(scholarships).map((entry) => [entry.id, entry.title]));
  const released = new Set(asList(resultsReleases).flatMap((release) => asList(release.applicationIds)));
  const groups = new Map();
  asList(applications).forEach((entry) => {
    const isPendingRelease = entry.status === 'Approved'
      || (['Released', 'Rejected'].includes(entry.status) && !released.has(entry.id));
    if (!isPendingRelease) return;
    const key = entry.scholarshipId;
    if (!groups.has(key)) {
      groups.set(key, { scholarshipId: key, title: titleById[key] || entry.scholarshipTitle || 'Scholarship', approved: [], decided: [] });
    }
    const group = groups.get(key);
    if (entry.status === 'Approved') group.approved.push(entry);
    else group.decided.push(entry);
  });
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
};

// Consultation 2, #12: an application goes straight to the interviewers of the
// applicant's school and cluster when it is submitted, with no assignment step.
// Routing is derived from each interviewer's scope through the same predicate
// the row-level policies use, so the intake pool can show where a case went and
// flag a cluster nobody covers yet.
export const getRoutedInterviewers = (application, staffDirectory = [], programIndex = new Map()) => asList(staffDirectory)
  .filter((entry) => isInterviewerRole(entry.role))
  .filter((entry) => isApplicationInReviewerScope(application, getReviewerScope(entry), programIndex))
  .sort((left, right) => String(left.fullName || '').localeCompare(String(right.fullName || '')));

// Each interviewer's open interview work: the cases in scope that wait for, or
// sit in, the interview stage. Read-only, like the officer workload.
export const getInterviewerWorkload = (applications = [], staffDirectory = [], programIndex = new Map()) => {
  const open = asList(applications).filter((entry) => ['Endorsed', 'Interview'].includes(entry.status));
  return asList(staffDirectory)
    .filter((entry) => isInterviewerRole(entry.role))
    .map((entry) => {
      const scope = getReviewerScope(entry);
      return {
        userId: entry.userId,
        fullName: entry.fullName || 'Interviewer',
        scopeLabel: getReviewScopeLabel(entry),
        cases: open.filter((application) => isApplicationInReviewerScope(application, scope, programIndex)).length,
      };
    })
    .sort((left, right) => right.cases - left.cases || left.fullName.localeCompare(right.fullName));
};
