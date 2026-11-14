import { getApplicationStatusLabel, sopStages } from './constants.js';
import { getApplicationScope } from './reviewScope.js';

// Search, facets, and sorting for the reviewer workspace's "Applications in your
// scope" list (Dean, Assistant Dean, Chairperson, interviewer). The chips above the
// list pick the work lane; these narrow and order whatever the lane holds. Pure and
// derived from the scoped queue only, so a facet never offers a value the account
// cannot see.

export const REVIEW_QUEUE_SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest submission first' },
  { value: 'newest', label: 'Newest submission first' },
  { value: 'name', label: 'Applicant A–Z' },
  { value: 'name-desc', label: 'Applicant Z–A' },
  { value: 'scholarship', label: 'Scholarship A–Z' },
  { value: 'stage', label: 'Stage (earliest first)' },
];

export const DEFAULT_REVIEW_QUEUE_FILTERS = {
  query: '',
  stage: 'all',
  scholarshipId: 'all',
  department: 'all',
  program: 'all',
  sort: 'updated',
};

const asList = (value) => (Array.isArray(value) ? value : []);

const timeOf = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};
const submittedTime = (entry = {}) => timeOf(entry.submittedAt || entry.updatedAt);
const updatedTime = (entry = {}) => timeOf(entry.updatedAt || entry.submittedAt);
const byId = (left, right) => String(left?.id || '').localeCompare(String(right?.id || ''));
const text = (value) => String(value || '').trim();
const compareText = (left, right) => text(left).localeCompare(text(right), undefined, { sensitivity: 'base' });
// SOP order, with the retired hand-off stage between verification and the interview.
const STAGE_ORDER = [...sopStages.slice(0, 3), 'For Endorsement', ...sopStages.slice(3)];
const stageRank = (entry = {}) => {
  const index = STAGE_ORDER.indexOf(entry.status);
  return index === -1 ? STAGE_ORDER.length : index;
};

const SORTERS = {
  updated: (left, right) => (updatedTime(right) - updatedTime(left)) || byId(left, right),
  oldest: (left, right) => (submittedTime(left) - submittedTime(right)) || byId(left, right),
  newest: (left, right) => (submittedTime(right) - submittedTime(left)) || byId(left, right),
  name: (left, right) => compareText(left.studentName, right.studentName) || byId(left, right),
  'name-desc': (left, right) => compareText(right.studentName, left.studentName) || byId(left, right),
  scholarship: (left, right) => (
    compareText(left.scholarshipTitle, right.scholarshipTitle)
    || compareText(left.studentName, right.studentName)
    || byId(left, right)
  ),
  stage: (left, right) => (
    (stageRank(left) - stageRank(right))
    || (submittedTime(left) - submittedTime(right))
    || byId(left, right)
  ),
};

export const getReviewQueueFacets = (entries = [], programIndex = new Map()) => {
  const stages = new Set();
  const scholarships = new Map();
  const departments = new Set();
  const programs = new Map();
  asList(entries).forEach((entry) => {
    if (!entry) return;
    if (entry.status) stages.add(entry.status);
    if (entry.scholarshipId) scholarships.set(entry.scholarshipId, entry.scholarshipTitle || 'Scholarship');
    const { department } = getApplicationScope(entry, programIndex);
    if (department) departments.add(department);
    if (entry.studentProgram) programs.set(entry.studentProgram, entry.studentProgram);
  });
  const byLabel = (left, right) => left.label.localeCompare(right.label);
  return {
    stages: [...stages]
      .sort((left, right) => stageRank({ status: left }) - stageRank({ status: right }))
      .map((value) => ({ value, label: getApplicationStatusLabel(value) })),
    scholarships: [...scholarships].map(([value, label]) => ({ value, label })).sort(byLabel),
    departments: [...departments].sort(compareText).map((value) => ({ value, label: value })),
    programs: [...programs].map(([value, label]) => ({ value, label })).sort(byLabel),
  };
};

export const filterReviewQueue = (entries = [], filters = {}, programIndex = new Map()) => {
  const merged = { ...DEFAULT_REVIEW_QUEUE_FILTERS, ...(filters || {}) };
  const query = text(merged.query).toLowerCase();
  const list = asList(entries).filter((entry) => {
    if (!entry) return false;
    if (merged.stage !== 'all' && entry.status !== merged.stage) return false;
    if (merged.scholarshipId !== 'all' && entry.scholarshipId !== merged.scholarshipId) return false;
    if (merged.program !== 'all' && entry.studentProgram !== merged.program) return false;
    const scope = getApplicationScope(entry, programIndex);
    if (merged.department !== 'all' && scope.department !== merged.department) return false;
    if (query) {
      const haystack = [
        entry.studentName,
        entry.scholarshipTitle,
        entry.studentProgram,
        scope.department,
        scope.cluster,
        getApplicationStatusLabel(entry.status),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  return list.sort(SORTERS[merged.sort] || SORTERS.updated);
};

// How many of the narrowing filters (everything but the search box and the sort)
// differ from their defaults, so a collapsed panel still says it is narrowing.
export const countActiveReviewQueueFilters = (filters = {}) => (
  ['stage', 'scholarshipId', 'department', 'program']
    .filter((key) => (filters[key] ?? 'all') !== DEFAULT_REVIEW_QUEUE_FILTERS[key]).length
);

export const hasReviewQueueRefinement = (filters = {}, defaults = DEFAULT_REVIEW_QUEUE_FILTERS) => (
  Boolean(text(filters.query))
  || countActiveReviewQueueFilters(filters) > 0
  || (filters.sort ?? defaults.sort) !== defaults.sort
);
