import { getApplicationStatusLabel, isAdmissionsAdminRole, isAdmissionsStaffRole } from './constants';
import { getReviewQueue } from './admissionsOffice';
import { findAcademicProgram } from './academicPrograms';
import { getApplicationScope, getReviewScopeLabel, getReviewerScope, isApproverForApplication, isLadderRole } from './reviewScope';
import { INTERVIEW_RECOMMENDATION_LEVELS, getLatestPanelRecommendation, isInterviewLive } from './interview';
import { getCurrentAcademicYear } from './profile';
import { buildXlsx, columnName, downloadBytes } from './xlsxWriter';

// The Statistics routes: `admin-statistics` for both Admissions Office lanes and
// `chair-statistics` for the reviewer ladder and interviewers. Every figure is an
// aggregate over the slices the signed-in role already loads (applications with
// their status log, attached Document Vault files, the panel's evaluation notes and
// panelists), so the page needs no new query, takes no stage action, and can never
// count a case outside the role's RLS scope. Drafts are never counted: they have
// not reached the office. Application rejection reasons live in the staff-only
// comment thread and are deliberately not read here.

const asList = (value) => (Array.isArray(value) ? value : []);
const DAY_MS = 86_400_000;

const toTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const ACCEPTED_STATUSES = ['Approved', 'Released'];

const isSubmittedApplication = (entry) => Boolean(entry) && entry.status && entry.status !== 'Draft';

const ratio = (part, whole) => (whole > 0 ? part / whole : null);

export const formatRate = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`);

export const formatDays = (value) => {
  if (value == null) return '—';
  if (value < 1) return '< 1 day';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
};

// Nearest-rank percentile over a list of numbers; null for an empty list.
export const percentile = (values = [], p = 50) => {
  const sorted = asList(values).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (p === 50) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
};

// When the application first entered each status: the append-only status log
// first, then the browser-written timeline for rows that predate it, and finally
// the submission date for `Submitted` itself.
export const getStatusEntryTimes = (application = {}) => {
  const times = {};
  const record = (status, at) => {
    const time = toTime(at);
    if (!status || time == null) return;
    if (times[status] == null || time < times[status]) times[status] = time;
  };
  const log = asList(application.statusLog);
  if (log.length) log.forEach((event) => record(event.toStatus, event.at));
  else asList(application.timeline).forEach((event) => record(event.stage, event.at));
  const submitted = toTime(application.submittedAt);
  if (submitted != null && (times.Submitted == null || submitted < times.Submitted)) times.Submitted = submitted;
  return times;
};

// --- Who sees what -------------------------------------------------------------

const LEVEL_LABELS = { school: 'School', cluster: 'Cluster', department: 'Department', program: 'Program' };

const breakdownFor = (parent, child) => ({
  parent,
  child,
  parentLabel: LEVEL_LABELS[parent],
  childLabel: child ? LEVEL_LABELS[child] : '',
  title: `By ${LEVEL_LABELS[parent].toLowerCase()}${child ? ` and ${LEVEL_LABELS[child].toLowerCase()}` : ''}`,
});

// The single statement of what each role's Statistics page holds.
//   - Admissions Office Admin: every school and every section.
//   - Admissions Office Staff: every school, volume only. Since Consultation 2
//     Staff are "not privy to the application process", so no acceptance rate,
//     no accepted / not-accepted counts, and no panel recommendation levels.
//   - Dean / Assistant Dean / Chairperson: their own level, broken down one or two
//     levels below it, plus the decisions they made as the approving level.
//   - Interviewer: their own level plus their own panel work.
// The `sections` flags gate the derivations themselves, not only the rendering.
export const getStatisticsScope = (role, profile = {}) => {
  if (isAdmissionsAdminRole(role) || isAdmissionsStaffRole(role)) {
    const isAdmin = isAdmissionsAdminRole(role);
    return {
      audience: isAdmin ? 'admin' : 'staff',
      scopeLabel: 'All schools',
      showSchoolFilter: true,
      breakdown: breakdownFor('school', 'department'),
      sections: { outcomes: isAdmin, recommendations: isAdmin, decisions: false, myInterviews: false },
    };
  }
  const scope = getReviewerScope({ ...profile, role });
  const breakdown = scope.level === 'school' ? breakdownFor('cluster', 'department')
    : scope.level === 'cluster' ? breakdownFor('department', 'program')
      // A Chairperson with no assigned department keeps the legacy school-wide read,
      // so it still gets a department breakdown.
      : scope.level === 'department' && scope.department ? breakdownFor('program', null)
        : breakdownFor('department', 'program');
  return {
    audience: 'reviewer',
    scopeLabel: getReviewScopeLabel({ ...profile, role }) || scope.legacySchool || 'Review scope unassigned',
    showSchoolFilter: false,
    breakdown,
    sections: { outcomes: true, recommendations: true, decisions: isLadderRole(role), myInterviews: true },
  };
};

// --- Filters ------------------------------------------------------------------

const academicYearOf = (entry) => {
  const time = toTime(entry?.submittedAt || entry?.updatedAt);
  return time == null ? '' : getCurrentAcademicYear(new Date(time));
};

export const ALL_FILTER_VALUE = 'all';

export const getAcademicYearOptions = (applications = [], today = new Date()) => {
  const years = new Set(asList(applications).filter(isSubmittedApplication).map(academicYearOf).filter(Boolean));
  years.add(getCurrentAcademicYear(today));
  return [...years].sort((left, right) => right.localeCompare(left));
};

export const getStatisticsFacets = (applications = [], programIndex = new Map()) => {
  const scholarships = new Map();
  const schools = new Set();
  asList(applications).filter(isSubmittedApplication).forEach((entry) => {
    if (entry.scholarshipId) scholarships.set(entry.scholarshipId, entry.scholarshipTitle || 'Scholarship');
    const { school } = getApplicationScope(entry, programIndex);
    if (school) schools.add(school);
  });
  return {
    scholarships: [...scholarships.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    schools: [...schools].sort((left, right) => left.localeCompare(right)),
  };
};

export const filterStatisticsApplications = (applications = [], filters = {}, programIndex = new Map()) => {
  const { academicYear = ALL_FILTER_VALUE, scholarshipId = ALL_FILTER_VALUE, school = ALL_FILTER_VALUE } = filters || {};
  return asList(applications).filter((entry) => {
    if (!isSubmittedApplication(entry)) return false;
    if (academicYear !== ALL_FILTER_VALUE && academicYearOf(entry) !== academicYear) return false;
    if (scholarshipId !== ALL_FILTER_VALUE && entry.scholarshipId !== scholarshipId) return false;
    if (school !== ALL_FILTER_VALUE && getApplicationScope(entry, programIndex).school !== school) return false;
    return true;
  });
};

// --- Headline -----------------------------------------------------------------

const decisionTime = (entry) => {
  const times = getStatusEntryTimes(entry);
  const decided = [times.Approved, times.Rejected].filter((value) => value != null);
  return decided.length ? Math.min(...decided) : null;
};

// The acceptance rate reads every decided case, including outcomes still held
// until release: the Admin is privy to them, and the page is never shown to a
// student.
export const getHeadlineStats = (applications = []) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const accepted = list.filter((entry) => ACCEPTED_STATUSES.includes(entry.status)).length;
  const notAccepted = list.filter((entry) => entry.status === 'Rejected').length;
  const decisionDays = list
    .map((entry) => {
      const start = toTime(entry.submittedAt);
      const end = decisionTime(entry);
      return start != null && end != null && end >= start ? (end - start) / DAY_MS : null;
    })
    .filter((value) => value != null);
  return {
    submitted: list.length,
    open: getReviewQueue(list).length,
    awaitingApproval: list.filter((entry) => entry.status === 'Recommended').length,
    awaitingRelease: list.filter((entry) => entry.status === 'Approved').length,
    released: list.filter((entry) => entry.status === 'Released').length,
    accepted,
    notAccepted,
    decided: accepted + notAccepted,
    acceptanceRate: ratio(accepted, accepted + notAccepted),
    medianDaysToDecision: percentile(decisionDays, 50),
  };
};

const CLOSED_STATUSES = ['Approved', 'Released', 'Rejected'];

// The Staff headline: where the volume sits, never how it was decided.
export const getVolumeHeadlineStats = (applications = []) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const countOf = (...statuses) => list.filter((entry) => statuses.includes(entry.status)).length;
  return {
    submitted: list.length,
    open: getReviewQueue(list).length,
    forVerification: countOf('Submitted', 'Under Review', 'For Verification', 'For Endorsement'),
    inInterview: countOf('Endorsed', 'Interview'),
    awaitingApproval: countOf('Recommended'),
    closed: countOf(...CLOSED_STATUSES),
  };
};

// --- Pipeline -----------------------------------------------------------------

// The statuses in SOP order, for the "where every case stands now" bars. The
// legacy `For Endorsement` hand-off only appears when a row still holds it.
const DISTRIBUTION_ORDER = ['Submitted', 'Under Review', 'For Verification', 'For Endorsement', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released', 'Rejected'];

// Without outcomes the three closing statuses fold into one "Closed" row, so the
// spread never tells an approval from a rejection.
export const getStatusDistribution = (applications = [], { outcomes = true } = {}) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const rows = DISTRIBUTION_ORDER
    .filter((status) => outcomes || !CLOSED_STATUSES.includes(status))
    .map((status) => ({ status, label: getApplicationStatusLabel(status), count: list.filter((entry) => entry.status === status).length }))
    .filter((row) => row.count > 0 || row.status !== 'For Endorsement');
  if (outcomes) return rows;
  return [...rows, { status: 'Closed', label: 'Closed', count: list.filter((entry) => CLOSED_STATUSES.includes(entry.status)).length }];
};

// The milestones a case passes on the way to a released result.
export const FUNNEL_MILESTONES = ['Submitted', 'For Verification', 'Endorsed', 'Interview', 'Recommended', 'Approved', 'Released'];
const MILESTONE_RANK = {
  Submitted: 0,
  'Under Review': 0,
  'For Verification': 1,
  'For Endorsement': 1,
  Endorsed: 2,
  Interview: 3,
  Recommended: 4,
  Approved: 5,
  Released: 6,
};

// How far each application got, from its history and its current status, so a
// row without a status log still counts every milestone its current stage implies.
const furthestMilestone = (entry) => {
  const statuses = [...Object.keys(getStatusEntryTimes(entry)), entry.status];
  return statuses.reduce((furthest, status) => Math.max(furthest, MILESTONE_RANK[status] ?? 0), 0);
};

// Without outcomes the funnel stops at the recommendation and ends with one
// "Decided by the school" milestone that counts approvals and rejections alike.
export const getStageFunnel = (applications = [], { outcomes = true } = {}) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const ranks = list.map(furthestMilestone);
  const total = ranks.length;
  const milestones = outcomes ? FUNNEL_MILESTONES : FUNNEL_MILESTONES.slice(0, FUNNEL_MILESTONES.indexOf('Approved'));
  const rows = milestones.map((status, index) => {
    const count = ranks.filter((rank) => rank >= index).length;
    return { status, label: getApplicationStatusLabel(status), count, share: ratio(count, total) };
  });
  if (outcomes) return rows;
  const decided = list.filter((entry) => {
    const times = getStatusEntryTimes(entry);
    return CLOSED_STATUSES.some((status) => entry.status === status || times[status] != null);
  }).length;
  return [...rows, { status: 'Decided', label: 'Decided by the school', count: decided, share: ratio(decided, total) }];
};

// --- Turnaround ---------------------------------------------------------------

export const TURNAROUND_STEPS = [
  { key: 'intake', label: 'Submission to document verification', from: ['Submitted'], to: ['For Verification'] },
  { key: 'verification', label: 'Document verification to forward for interview', from: ['For Verification'], to: ['Endorsed'] },
  { key: 'scheduling', label: 'Forward to interview scheduled', from: ['Endorsed'], to: ['Interview'] },
  { key: 'interview', label: 'Interview to panel recommendation', from: ['Interview'], to: ['Recommended'] },
  { key: 'approval', label: 'Recommendation to school decision', from: ['Recommended'], to: ['Approved', 'Rejected'] },
  { key: 'release', label: 'Approval to results release', from: ['Approved'], to: ['Released'] },
];

// The office's own working target for one step (the endorsement timing uses the
// same five days), so a step whose median runs past it is flagged.
export const TURNAROUND_TARGET_DAYS = 5;

// Without outcomes the release step is left out: its sample size is the number
// of approved cases.
export const getStageTurnaround = (applications = [], { outcomes = true } = {}) => {
  const timings = asList(applications).filter(isSubmittedApplication).map(getStatusEntryTimes);
  return TURNAROUND_STEPS.filter((step) => outcomes || step.key !== 'release').map((step) => {
    const days = timings
      .map((times) => {
        const start = step.from.map((status) => times[status]).find((value) => value != null);
        const ends = step.to.map((status) => times[status]).filter((value) => value != null && start != null && value >= start);
        return start != null && ends.length ? (Math.min(...ends) - start) / DAY_MS : null;
      })
      .filter((value) => value != null);
    const median = percentile(days, 50);
    return {
      key: step.key,
      label: step.label,
      count: days.length,
      median,
      p90: percentile(days, 90),
      overTarget: median != null && median > TURNAROUND_TARGET_DAYS,
    };
  });
};

// --- Submissions over time ----------------------------------------------------

const MANILA_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
const manilaDay = (time) => {
  const [year, month, day] = MANILA_PARTS.format(new Date(time)).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const MONTH_LABEL = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const WEEK_LABEL = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const bucketStart = (day, bucket) => {
  const date = new Date(day);
  if (bucket === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  // Weeks start on Monday.
  return day - (((date.getUTCDay() + 6) % 7) * DAY_MS);
};

const nextBucket = (start, bucket) => {
  if (bucket === 'month') {
    const date = new Date(start);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  return start + 7 * DAY_MS;
};

// Submissions per Manila week or month, gaps filled with zero, newest `limit`
// buckets kept so the chart stays readable on a phone.
export const getSubmissionTrend = (applications = [], { bucket = 'month', limit = 18 } = {}) => {
  const counts = new Map();
  asList(applications).filter(isSubmittedApplication).forEach((entry) => {
    const time = toTime(entry.submittedAt);
    if (time == null) return;
    const key = bucketStart(manilaDay(time), bucket);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  if (!counts.size) return [];
  const keys = [...counts.keys()];
  const rows = [];
  for (let start = Math.min(...keys), end = Math.max(...keys); start <= end; start = nextBucket(start, bucket)) {
    rows.push({
      key: String(start),
      label: (bucket === 'month' ? MONTH_LABEL : WEEK_LABEL).format(new Date(start)),
      count: counts.get(start) || 0,
    });
  }
  return rows.slice(-limit);
};

// --- Breakdowns ---------------------------------------------------------------

const summarize = (list, { outcomes = true } = {}) => {
  if (!outcomes) {
    // Volume only: how many applied and how many are still moving.
    return { applied: list.length, inProgress: list.filter((entry) => !CLOSED_STATUSES.includes(entry.status)).length };
  }
  const accepted = list.filter((entry) => ACCEPTED_STATUSES.includes(entry.status)).length;
  const notAccepted = list.filter((entry) => entry.status === 'Rejected').length;
  return {
    applied: list.length,
    inProgress: list.length - accepted - notAccepted,
    accepted,
    notAccepted,
    acceptanceRate: ratio(accepted, accepted + notAccepted),
  };
};

const groupBy = (list, keyOf) => {
  const groups = new Map();
  list.forEach((entry) => {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return groups;
};

const byAppliedThenLabel = (left, right) => (right.applied - left.applied) || left.label.localeCompare(right.label);

export const getBreakdownByScholarship = (applications = [], { outcomes = true } = {}) => {
  const list = asList(applications).filter(isSubmittedApplication);
  return [...groupBy(list, (entry) => entry.scholarshipId || entry.scholarshipTitle || 'unknown').entries()]
    .map(([key, rows]) => ({ key, label: rows[0].scholarshipTitle || 'Scholarship', ...summarize(rows, { outcomes }) }))
    .sort(byAppliedThenLabel);
};

const UNASSIGNED = 'Not recorded';

// The label of one hierarchy level for an application. SEA, SOE, and SON have no
// cluster, so a blank cluster reads as the school's direct programs.
const levelValue = (row, level) => {
  if (level === 'cluster') return row.scope.cluster || (row.scope.school ? 'Direct under the school' : UNASSIGNED);
  if (level === 'program') return findAcademicProgram(row.entry.studentProgram)?.label || row.entry.studentProgram || UNASSIGNED;
  return row.scope[level] || UNASSIGNED;
};

// One level, then optionally the level below it inside each group: School ->
// Department for the office, Cluster -> Department for a Dean, Department ->
// Program for an Assistant Dean, and a flat Program list for a Chairperson.
export const getBreakdownByHierarchy = (applications = [], programIndex = new Map(), { parent = 'school', child = 'department', outcomes = true } = {}) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const scoped = list.map((entry) => ({ entry, scope: getApplicationScope(entry, programIndex) }));
  return [...groupBy(scoped, (row) => levelValue(row, parent)).entries()]
    .map(([label, rows]) => ({
      key: label,
      label,
      ...summarize(rows.map((row) => row.entry), { outcomes }),
      children: child
        ? [...groupBy(rows, (row) => levelValue(row, child)).entries()]
          .map(([childLabel, members]) => ({ key: `${label}::${childLabel}`, label: childLabel, ...summarize(members.map((row) => row.entry), { outcomes }) }))
          .sort(byAppliedThenLabel)
        : [],
    }))
    .sort(byAppliedThenLabel);
};

// --- Document Vault -----------------------------------------------------------

// The preset part of a revert reason ("<reason> — <notes>"), so free-text notes
// never split one reason into many rows.
const presetReason = (value) => String(value || '').split(' — ')[0].trim();

export const getDocumentStats = (applications = [], documents = []) => {
  const attached = new Set(asList(applications)
    .filter(isSubmittedApplication)
    .flatMap((entry) => asList(entry.attachedDocuments)));
  const files = asList(documents).filter((entry) => attached.has(entry.id));
  const countOf = (status) => files.filter((entry) => entry.verificationStatus === status).length;
  const reverted = countOf('Rejected');
  const decided = countOf('Verified') + reverted;

  const byType = [...groupBy(files, (entry) => entry.documentType || 'Other').entries()]
    .map(([type, rows]) => {
      const typeReverted = rows.filter((entry) => entry.verificationStatus === 'Rejected').length;
      const typeDecided = rows.filter((entry) => ['Verified', 'Rejected'].includes(entry.verificationStatus)).length;
      return { key: type, label: type, total: rows.length, reverted: typeReverted, revertRate: ratio(typeReverted, typeDecided) };
    })
    .sort((left, right) => (right.reverted - left.reverted) || (right.total - left.total) || left.label.localeCompare(right.label));

  const reasons = [...groupBy(files.filter((entry) => entry.verificationStatus === 'Rejected'), (entry) => presetReason(entry.rejectionReason) || 'No reason recorded').entries()]
    .map(([reason, rows]) => ({ key: reason, label: reason, count: rows.length }))
    .sort((left, right) => (right.count - left.count) || left.label.localeCompare(right.label));

  const decisionDays = files
    .map((entry) => {
      const start = toTime(entry.uploadedAt);
      const end = toTime(entry.decidedAt);
      return start != null && end != null && end >= start ? (end - start) / DAY_MS : null;
    })
    .filter((value) => value != null);

  return {
    total: files.length,
    pending: countOf('Pending'),
    verified: countOf('Verified'),
    reverted,
    revertRate: ratio(reverted, decided),
    medianDaysToDecision: percentile(decisionDays, 50),
    byType,
    reasons,
  };
};

// --- Panel recommendations ----------------------------------------------------

export const getPanelRecommendationStats = (applications = [], interviewNotes = []) => {
  const notesByApplication = groupBy(asList(interviewNotes), (note) => note.applicationId);
  const list = asList(applications).filter(isSubmittedApplication);
  const recorded = list
    .map((entry) => ({ entry, recommendation: getLatestPanelRecommendation(notesByApplication.get(entry.id) || []) }))
    .filter((row) => row.recommendation);
  const levels = INTERVIEW_RECOMMENDATION_LEVELS.map((level) => {
    const rows = recorded.filter((row) => row.recommendation.level === level.value).map((row) => row.entry);
    return { key: level.value, label: level.label, count: rows.length, ...summarize(rows) };
  });
  return { recorded: recorded.length, levels };
};

// --- The approving level's own decisions (SOP step 7) ---------------------------

// The recommendations this reviewer is the configured approving level for, how
// they were decided, and the panel's level against the decision. Reads the same
// predicate as the Approve action, so the page counts exactly the cases the
// account could approve.
export const getApproverStats = (applications = [], profile = {}, approvalLevels = [], programIndex = new Map(), interviewNotes = []) => {
  const notesByApplication = groupBy(asList(interviewNotes), (note) => note.applicationId);
  const mine = asList(applications)
    .filter(isSubmittedApplication)
    .filter((entry) => furthestMilestone(entry) >= MILESTONE_RANK.Recommended || getStatusEntryTimes(entry).Recommended != null)
    .filter((entry) => isApproverForApplication(entry, profile, approvalLevels, programIndex));
  const decisionDays = mine
    .map((entry) => {
      const times = getStatusEntryTimes(entry);
      const decided = [times.Approved, times.Rejected].filter((value) => value != null && times.Recommended != null && value >= times.Recommended);
      return decided.length ? (Math.min(...decided) - times.Recommended) / DAY_MS : null;
    })
    .filter((value) => value != null);
  const withLevel = mine.map((entry) => ({ entry, recommendation: getLatestPanelRecommendation(notesByApplication.get(entry.id) || []) }));
  const approved = mine.filter((entry) => ACCEPTED_STATUSES.includes(entry.status)).length;
  const notAccepted = mine.filter((entry) => entry.status === 'Rejected').length;
  return {
    total: mine.length,
    awaiting: mine.filter((entry) => entry.status === 'Recommended').length,
    approved,
    notAccepted,
    approvalRate: ratio(approved, approved + notAccepted),
    medianDaysToDecision: percentile(decisionDays, 50),
    byLevel: [...INTERVIEW_RECOMMENDATION_LEVELS, { value: '', label: 'No level recorded' }]
      .map((level) => {
        const rows = withLevel.filter((row) => (row.recommendation?.level || '') === level.value).map((row) => row.entry);
        return {
          key: level.value || 'none',
          label: level.label,
          count: rows.length,
          awaiting: rows.filter((entry) => entry.status === 'Recommended').length,
          approved: rows.filter((entry) => ACCEPTED_STATUSES.includes(entry.status)).length,
          notAccepted: rows.filter((entry) => entry.status === 'Rejected').length,
        };
      })
      .filter((row) => row.count > 0),
  };
};

// --- The signed-in reviewer's own panel work (SOP step 5) -----------------------

export const getMyInterviewStats = (applications = [], interviewPanelists = [], interviewNotes = [], viewerId = '', now = new Date()) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const inScope = new Set(list.map((entry) => entry.id));
  const panels = asList(interviewPanelists)
    .filter((entry) => viewerId && entry.profileId === viewerId && !entry.removedAt && inScope.has(entry.applicationId));
  const panelIds = new Set(panels.map((entry) => entry.applicationId));
  const scheduledIds = new Set(list.filter((entry) => viewerId && entry.interview?.scheduledBy === viewerId).map((entry) => entry.id));
  const involved = list.filter((entry) => panelIds.has(entry.id) || scheduledIds.has(entry.id));
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const upcoming = involved.filter((entry) => {
    const startsAt = toTime(entry.interview?.startsAt);
    return entry.status === 'Interview' && isInterviewLive(entry.interview) && startsAt != null && startsAt >= nowTime;
  }).length;
  const myNotes = asList(interviewNotes).filter((note) => viewerId && note.authorId === viewerId && inScope.has(note.applicationId));
  const latestMine = [...groupBy(myNotes, (note) => note.applicationId).values()]
    .map((notes) => getLatestPanelRecommendation(notes))
    .filter(Boolean);
  return {
    involved: involved.length,
    onPanel: panelIds.size,
    leading: new Set(panels.filter((entry) => entry.isLead).map((entry) => entry.applicationId)).size,
    scheduledByMe: scheduledIds.size,
    upcoming,
    notesRecorded: myNotes.length,
    recommended: latestMine.length,
    levels: INTERVIEW_RECOMMENDATION_LEVELS.map((level) => ({
      key: level.value,
      label: level.label,
      count: latestMine.filter((entry) => entry.level === level.value).length,
    })),
  };
};

// --- Applicant profile (frozen snapshot) --------------------------------------

const numberOrNull = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const band = (value, bands) => {
  if (value == null) return UNASSIGNED;
  return (bands.find((entry) => value < entry.below) || bands[bands.length - 1]).label;
};

const QPI_BANDS = [
  { below: 2.5, label: 'Below 2.50' },
  { below: 3, label: '2.50 – 2.99' },
  { below: 3.5, label: '3.00 – 3.49' },
  { below: Infinity, label: '3.50 – 4.00' },
];
const SHS_BANDS = [
  { below: 85, label: 'Below 85' },
  { below: 90, label: '85 – 89' },
  { below: 95, label: '90 – 94' },
  { below: Infinity, label: '95 – 100' },
];
const INCOME_BANDS = [
  { below: 150_000, label: 'Below ₱150,000' },
  { below: 250_000, label: '₱150,000 – ₱249,999' },
  { below: 400_000, label: '₱250,000 – ₱399,999' },
  { below: 600_000, label: '₱400,000 – ₱599,999' },
  { below: Infinity, label: '₱600,000 and above' },
];

const applicantStatusOf = (entry) => {
  const snapshot = entry.profileSnapshot || {};
  if (snapshot.academic?.credential === 'hsAverage') return 'Incoming first year';
  if (snapshot.eligibility?.isTransferee === 'Yes') return 'Transferee';
  if (snapshot.academic?.credential === 'qpi') return 'Current Ateneo student';
  return UNASSIGNED;
};

// Counts in the band order, with "Not recorded" last; empty bands are kept so the
// bars always read the same scale.
const countBands = (values, labels) => {
  const counts = new Map(labels.map((label) => [label, 0]));
  values.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
  return [...counts.entries()]
    .filter(([label, count]) => label !== UNASSIGNED || count > 0)
    .map(([label, count]) => ({ key: label, label, count }));
};

export const getApplicantProfileStats = (applications = []) => {
  const list = asList(applications).filter(isSubmittedApplication);
  const academicOf = (credential) => list
    .filter((entry) => entry.profileSnapshot?.academic?.credential === credential)
    .map((entry) => numberOrNull(entry.profileSnapshot.academic.value));
  const statusLabels = ['Incoming first year', 'Current Ateneo student', 'Transferee', UNASSIGNED];
  const standingLabels = [...new Set(list.map((entry) => entry.profileSnapshot?.yearStandingLabel).filter(Boolean))];
  return {
    applicantStatus: countBands(list.map(applicantStatusOf), statusLabels),
    yearStanding: countBands(list.map((entry) => entry.profileSnapshot?.yearStandingLabel || UNASSIGNED), standingLabels),
    qpi: countBands(academicOf('qpi').map((value) => band(value, QPI_BANDS)), QPI_BANDS.map((entry) => entry.label)),
    shsAverage: countBands(academicOf('hsAverage').map((value) => band(value, SHS_BANDS)), SHS_BANDS.map((entry) => entry.label)),
    householdIncome: countBands(
      list.map((entry) => band(numberOrNull(entry.profileSnapshot?.householdIncome?.value ?? entry.studentHouseholdIncome), INCOME_BANDS)),
      INCOME_BANDS.map((entry) => entry.label),
    ),
  };
};

// --- All of it at once --------------------------------------------------------

// `scope` is getStatisticsScope()'s answer; it defaults to the Admin's. A section a
// role does not get is never derived, so its figures cannot reach the page or the
// export: `headline` is the volume headline and `recommendations`, `decisions`, and
// `myInterviews` are null when they are off.
export const buildOfficeStatistics = ({
  applications = [],
  documents = [],
  interviewNotes = [],
  interviewPanelists = [],
  approvalLevels = [],
  programIndex = new Map(),
  trendBucket = 'month',
  scope = getStatisticsScope('admissions_admin'),
  profile = {},
  viewerId = '',
  now = new Date(),
} = {}) => {
  const { sections, breakdown } = scope;
  const outcomes = Boolean(sections.outcomes);
  return {
    sections,
    breakdown,
    headline: outcomes ? getHeadlineStats(applications) : getVolumeHeadlineStats(applications),
    distribution: getStatusDistribution(applications, { outcomes }),
    funnel: getStageFunnel(applications, { outcomes }),
    turnaround: getStageTurnaround(applications, { outcomes }),
    trend: getSubmissionTrend(applications, { bucket: trendBucket }),
    byScholarship: getBreakdownByScholarship(applications, { outcomes }),
    byHierarchy: getBreakdownByHierarchy(applications, programIndex, { parent: breakdown.parent, child: breakdown.child, outcomes }),
    documents: getDocumentStats(applications, documents),
    recommendations: sections.recommendations ? getPanelRecommendationStats(applications, interviewNotes) : null,
    decisions: sections.decisions ? getApproverStats(applications, profile, approvalLevels, programIndex, interviewNotes) : null,
    myInterviews: sections.myInterviews ? getMyInterviewStats(applications, interviewPanelists, interviewNotes, viewerId, now) : null,
    profile: getApplicantProfileStats(applications),
  };
};

// --- Excel export -------------------------------------------------------------

const rateCell = (value) => (value == null ? { value: 'N/A', type: 'text', style: 'na' } : { value: `${Math.round(value * 100)}%`, style: 'text' });
const daysCell = (value) => (value == null ? { value: 'N/A', type: 'text', style: 'na' } : { value: Math.round(value * 10) / 10, style: 'number' });
const intCell = (value) => ({ value, style: 'integer' });

const tableSheet = (name, title, meta, headers, rows, widths) => {
  const lastColumn = columnName(Math.max(headers.length, 3) - 1);
  const blanks = (count, style) => Array.from({ length: Math.max(0, count) }, () => ({ value: '', style }));
  const metaRows = meta.map(([label, value]) => [
    { value: label, style: 'metaLabel' }, { value, style: 'metaValue' }, ...blanks(headers.length - 2, 'metaValue'),
  ]);
  const headerRowNumber = 1 + metaRows.length + 2;
  return {
    name,
    rows: [
      [{ value: title, style: 'title' }, ...blanks(headers.length - 1, 'title')],
      ...metaRows,
      [],
      headers.map((label) => ({ value: label, style: 'header' })),
      // A label cell without a style takes the bordered text style of the table.
      ...rows.map((row) => row.map((cell) => (cell && typeof cell === 'object' && !cell.style ? { ...cell, style: 'text' } : cell))),
    ],
    columnWidths: widths,
    rowHeights: { 1: 30, [headerRowNumber]: 30 },
    merges: [`A1:${lastColumn}1`, ...metaRows.map((_, index) => `B${index + 2}:${lastColumn}${index + 2}`)],
    freeze: { row: headerRowNumber },
  };
};

const OUTCOME_HEADERS = ['Applied', 'In progress', 'Accepted', 'Not accepted', 'Acceptance rate'];
const VOLUME_HEADERS = ['Applied', 'In progress'];
const breakdownCells = (row, outcomes) => (outcomes
  ? [intCell(row.applied), intCell(row.inProgress), intCell(row.accepted), intCell(row.notAccepted), rateCell(row.acceptanceRate)]
  : [intCell(row.applied), intCell(row.inProgress)]);

const headlineRows = (headline, outcomes) => (outcomes ? [
  ['Applications submitted', intCell(headline.submitted)],
  ['Open cases', intCell(headline.open)],
  ['Awaiting the school’s approval', intCell(headline.awaitingApproval)],
  ['Approved, awaiting release', intCell(headline.awaitingRelease)],
  ['Released (accepted)', intCell(headline.released)],
  ['Not accepted', intCell(headline.notAccepted)],
  ['Acceptance rate (decided cases)', rateCell(headline.acceptanceRate)],
  ['Median days, submission to decision', daysCell(headline.medianDaysToDecision)],
] : [
  ['Applications submitted', intCell(headline.submitted)],
  ['Open cases', intCell(headline.open)],
  ['Before or at document verification', intCell(headline.forVerification)],
  ['For interview or in interview', intCell(headline.inInterview)],
  ['Awaiting the school', intCell(headline.awaitingApproval)],
  ['Closed', intCell(headline.closed)],
]).map(([label, cell]) => [{ value: label }, cell]);

// `source` names where the file came from and the filters applied:
//   { origin, filters: 'Academic year 2026-2027 · All scholarships · All schools', exportedBy, now }
// Every sheet holds counts only; no applicant is named. The sheets follow the
// sections the role's page shows (`stats.sections`), so a volume-only page exports
// a volume-only file.
export const buildStatisticsSheets = (stats, source = {}) => {
  const outcomes = stats.sections?.outcomes !== false;
  const breakdown = stats.breakdown || breakdownFor('school', 'department');
  const exportedOn = (source.now instanceof Date ? source.now : new Date())
    .toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' });
  const meta = [
    ['Exported from', source.origin || 'Admissions Office › Statistics'],
    ['Scope', source.scope],
    ['Filters', source.filters],
    ['Exported on', `${exportedOn} (Asia/Manila)${source.exportedBy ? ` by ${source.exportedBy}` : ''}`],
    ['Note', outcomes
      ? 'Counts only. Acceptance rates include decided outcomes still held until release. Decision reasons are never exported.'
      : 'Counts only. Application volume and timing; decisions and panel recommendations are not included.'],
  ].filter(([, value]) => value);
  const { headline } = stats;
  const breakdownHeaders = outcomes ? OUTCOME_HEADERS : VOLUME_HEADERS;
  const breakdownWidths = outcomes ? [11, 12, 11, 13, 15] : [11, 12];
  const hierarchyRows = stats.byHierarchy.flatMap((group) => (breakdown.child
    ? [
      [{ value: group.label, style: 'metaLabel' }, { value: `All of the ${breakdown.parentLabel.toLowerCase()}`, style: 'metaLabel' }, ...breakdownCells(group, outcomes)],
      ...group.children.map((row) => [{ value: group.label }, { value: row.label }, ...breakdownCells(row, outcomes)]),
    ]
    : [[{ value: group.label }, ...breakdownCells(group, outcomes)]]));

  const sheets = [
    tableSheet('Summary', `ScholarPath AdDU — ${source.title || 'Statistics'}`, meta, ['Measure', 'Value', ''], [
      ...headlineRows(headline, outcomes),
      [],
      [{ value: 'Milestone reached', style: 'header' }, { value: 'Applications', style: 'header' }, { value: 'Share of submitted', style: 'header' }],
      ...stats.funnel.map((row) => [{ value: row.label }, intCell(row.count), rateCell(row.share)]),
      [],
      [{ value: 'Current stage', style: 'header' }, { value: 'Applications', style: 'header' }],
      ...stats.distribution.map((row) => [{ value: row.label }, intCell(row.count)]),
    ], [40, 16, 20]),
    tableSheet('By scholarship', 'Applications by scholarship', meta, ['Scholarship', ...breakdownHeaders],
      stats.byScholarship.map((row) => [{ value: row.label }, ...breakdownCells(row, outcomes)]), [34, ...breakdownWidths]),
    tableSheet(`By ${breakdown.parentLabel.toLowerCase()}`, `Applications ${breakdown.title.toLowerCase()}`, meta,
      [breakdown.parentLabel, ...(breakdown.child ? [breakdown.childLabel] : []), ...breakdownHeaders],
      hierarchyRows, [36, ...(breakdown.child ? [34] : []), ...breakdownWidths]),
    tableSheet('Stage turnaround', 'Days spent in each step', meta, ['Step', 'Cases measured', 'Median days', '90th percentile days', `Median over ${TURNAROUND_TARGET_DAYS} days`],
      stats.turnaround.map((row) => [{ value: row.label }, intCell(row.count), daysCell(row.median), daysCell(row.p90), { value: row.overTarget ? 'Yes' : 'No' }]), [44, 15, 13, 19, 18]),
    tableSheet('Documents', 'Document Vault verification', meta, ['Document type', 'Attached files', 'Reverted', 'Revert rate'], [
      ...stats.documents.byType.map((row) => [{ value: row.label }, intCell(row.total), intCell(row.reverted), rateCell(row.revertRate)]),
      [],
      [{ value: 'Revert reason', style: 'header' }, { value: 'Files', style: 'header' }],
      ...stats.documents.reasons.map((row) => [{ value: row.label }, intCell(row.count)]),
    ], [40, 15, 11, 13]),
  ];

  if (stats.recommendations) {
    sheets.push(tableSheet('Panel recommendations', 'Latest panel recommendation per application', meta, ['Recommendation level', 'Applications', 'Accepted', 'Not accepted', 'Still in progress'],
      stats.recommendations.levels.map((row) => [{ value: row.label }, intCell(row.count), intCell(row.accepted), intCell(row.notAccepted), intCell(row.inProgress)]), [32, 13, 11, 13, 16]));
  }
  if (stats.decisions?.total) {
    const { decisions } = stats;
    sheets.push(tableSheet('Your decisions', 'Recommendations you decide as the approving level', meta, ['Panel recommendation', 'Cases', 'Awaiting your decision', 'Approved', 'Not accepted'], [
      ...decisions.byLevel.map((row) => [{ value: row.label }, intCell(row.count), intCell(row.awaiting), intCell(row.approved), intCell(row.notAccepted)]),
      [],
      [{ value: 'Approval rate (decided cases)' }, rateCell(decisions.approvalRate)],
      [{ value: 'Median days, recommendation to decision' }, daysCell(decisions.medianDaysToDecision)],
    ], [34, 11, 20, 11, 13]));
  }
  if (stats.myInterviews?.involved) {
    const mine = stats.myInterviews;
    sheets.push(tableSheet('My interviews', 'Your panel work', meta, ['Measure', 'Value', ''], [
      [{ value: 'Cases you are on the panel of' }, intCell(mine.onPanel)],
      [{ value: 'Panels you lead' }, intCell(mine.leading)],
      [{ value: 'Interviews you scheduled' }, intCell(mine.scheduledByMe)],
      [{ value: 'Upcoming interviews' }, intCell(mine.upcoming)],
      [{ value: 'Evaluation notes you recorded' }, intCell(mine.notesRecorded)],
      [],
      [{ value: 'Your latest recommendation level', style: 'header' }, { value: 'Cases', style: 'header' }],
      ...mine.levels.map((row) => [{ value: row.label }, intCell(row.count)]),
    ], [40, 12, 4]));
  }
  return sheets;
};

export const getStatisticsFileName = (...parts) => {
  const safe = parts
    .filter(Boolean)
    .map((part) => String(part).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
  return `Office_statistics_${[...safe, MANILA_PARTS.format(new Date())].join('_')}.xlsx`;
};

export const downloadStatisticsWorkbook = (stats, source = {}, fileName = getStatisticsFileName()) => {
  downloadBytes(buildXlsx(buildStatisticsSheets(stats, source), source.now instanceof Date ? source.now : new Date()), fileName);
};
