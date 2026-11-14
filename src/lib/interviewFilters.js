import { getInterviewDateKey } from './interview.js';
import { getReviewQueueFacets } from './reviewQueue.js';
import { getApplicationScope } from './reviewScope.js';

// Search, facets, and sorting for the interview boards (the Admissions Office's
// Interview schedule and every reviewer's Interviews page). The chips above a board
// pick the category; these narrow and order what it holds. They read the items the
// page already scoped, so a facet never offers a value the account cannot see, and
// they never write anything.
//
// An item is either a roster entry (`getInterviewEntries()`: a scheduled, cancelled,
// or closed interview with a start time) or a plain application that still needs a
// schedule. The entry-only filters (mode, date) leave an unscheduled application
// alone, because it has neither.

export const INTERVIEW_WHEN_OPTIONS = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Next 7 days' },
];

export const INTERVIEW_MODE_OPTIONS = [
  { value: 'all', label: 'On-site and online' },
  { value: 'onsite', label: 'On-site' },
  { value: 'online', label: 'Online' },
];

// `soonest` / `latest` order by the interview's start; on the list of applicants
// still to be scheduled they mean how long the case has waited.
export const INTERVIEW_SORTS = [
  { value: 'soonest', label: 'Soonest first' },
  { value: 'latest', label: 'Latest first' },
  { value: 'name', label: 'Applicant A–Z' },
  { value: 'name-desc', label: 'Applicant Z–A' },
  { value: 'scholarship', label: 'Scholarship A–Z' },
];

export const SCHEDULE_SORTS = [
  { value: 'soonest', label: 'Longest waiting' },
  { value: 'latest', label: 'Most recent' },
  ...INTERVIEW_SORTS.slice(2),
];

export const DEFAULT_INTERVIEW_FILTERS = {
  query: '',
  mode: 'all',
  when: 'all',
  scholarshipId: 'all',
  department: 'all',
  program: 'all',
  sort: 'soonest',
};

const NARROWING_KEYS = ['mode', 'when', 'scholarshipId', 'department', 'program'];

const asList = (value) => (Array.isArray(value) ? value : []);
const appOf = (item = {}) => item.application || item;
const text = (value) => String(value || '').trim();
const compareText = (left, right) => text(left).localeCompare(text(right), undefined, { sensitivity: 'base' });
const timeOf = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};
// When the item sits on the clock: an interview's start, or the date an unscheduled
// application last moved (it has no start).
const clockOf = (item) => (item.startsAtDate ? item.startsAtDate.getTime() : timeOf(appOf(item).updatedAt || appOf(item).submittedAt));
const idOf = (item) => String(item.applicationId || item.id || '');

const SORTERS = {
  soonest: (left, right) => (clockOf(left) - clockOf(right)) || idOf(left).localeCompare(idOf(right)),
  latest: (left, right) => (clockOf(right) - clockOf(left)) || idOf(left).localeCompare(idOf(right)),
  name: (left, right) => compareText(appOf(left).studentName, appOf(right).studentName) || idOf(left).localeCompare(idOf(right)),
  'name-desc': (left, right) => compareText(appOf(right).studentName, appOf(left).studentName) || idOf(left).localeCompare(idOf(right)),
  scholarship: (left, right) => (
    compareText(appOf(left).scholarshipTitle, appOf(right).scholarshipTitle)
    || compareText(appOf(left).studentName, appOf(right).studentName)
    || idOf(left).localeCompare(idOf(right))
  ),
};

const addDaysKey = (now, days) => getInterviewDateKey(new Date(now.getTime() + days * 86400000).toISOString());

export const getInterviewFacets = (items = [], programIndex = new Map()) => {
  const { scholarships, departments, programs } = getReviewQueueFacets(asList(items).map(appOf), programIndex);
  return { scholarships, departments, programs };
};

// `extraTextOf(item)` lets a page add what only it knows (the panel's names) to the
// text the search reads.
export const filterInterviewItems = (items = [], filters = {}, { programIndex = new Map(), now = new Date(), extraTextOf = null } = {}) => {
  const merged = { ...DEFAULT_INTERVIEW_FILTERS, ...(filters || {}) };
  const query = text(merged.query).toLowerCase();
  const todayKey = merged.when !== 'all' ? getInterviewDateKey(now.toISOString()) : '';
  const weekKey = merged.when === 'week' ? addDaysKey(now, 7) : '';
  const list = asList(items).filter((item) => {
    if (!item) return false;
    const application = appOf(item);
    if (merged.scholarshipId !== 'all' && application.scholarshipId !== merged.scholarshipId) return false;
    if (merged.program !== 'all' && application.studentProgram !== merged.program) return false;
    const scope = getApplicationScope(application, programIndex);
    if (merged.department !== 'all' && scope.department !== merged.department) return false;
    if (item.startsAtDate) {
      if (merged.mode !== 'all' && item.mode !== merged.mode) return false;
      if (merged.when === 'today' && item.dateKey !== todayKey) return false;
      if (merged.when === 'week' && !(item.dateKey >= todayKey && item.dateKey <= weekKey)) return false;
    }
    if (query) {
      const haystack = [
        application.studentName,
        application.scholarshipTitle,
        application.studentProgram,
        scope.department,
        scope.cluster,
        item.locationLabel,
        extraTextOf ? extraTextOf(item) : '',
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  return list.sort(SORTERS[merged.sort] || SORTERS.soonest);
};

// Interviews grouped under a Manila day heading while the sort is by time; any
// other sort is one flat list, which the page renders without day headings.
export const isInterviewDaySort = (sort) => sort === 'soonest' || sort === 'latest' || !sort;

export const groupInterviewsForSort = (entries = [], sort = 'soonest') => {
  const list = asList(entries);
  if (!list.length) return [];
  if (!isInterviewDaySort(sort)) return [{ dateKey: '', entries: list }];
  const days = new Map();
  list.forEach((entry) => {
    const key = entry.dateKey || '';
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  });
  // The entries arrive already ordered by the chosen sort, so a day keeps that
  // order inside it and the days follow the first entry that opens each one.
  return [...days.entries()].map(([dateKey, dayEntries]) => ({ dateKey, entries: dayEntries }));
};

export const countActiveInterviewFilters = (filters = {}) => (
  NARROWING_KEYS.filter((key) => (filters[key] ?? 'all') !== DEFAULT_INTERVIEW_FILTERS[key]).length
);

export const hasInterviewRefinement = (filters = {}) => (
  Boolean(text(filters.query))
  || countActiveInterviewFilters(filters) > 0
  || (filters.sort ?? DEFAULT_INTERVIEW_FILTERS.sort) !== DEFAULT_INTERVIEW_FILTERS.sort
);
