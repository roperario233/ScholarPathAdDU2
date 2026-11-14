import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVIEW_FILTERS,
  countActiveInterviewFilters,
  filterInterviewItems,
  getInterviewFacets,
  groupInterviewsForSort,
  hasInterviewRefinement,
  isInterviewDaySort,
} from '../src/lib/interviewFilters';

const programIndex = new Map([
  ['BS Biology', { school: 'School of Arts and Sciences', cluster: 'Natural Sciences', department: 'Biology' }],
  ['BS Mathematics', { school: 'School of Arts and Sciences', cluster: 'Natural Sciences', department: 'Mathematics' }],
]);

const now = new Date('2026-11-10T02:00:00Z'); // 10:00 Manila, Nov 10

const entry = (id, name, program, iso, extra = {}) => {
  const startsAtDate = new Date(iso);
  return {
    applicationId: id,
    application: { id, studentName: name, studentProgram: program, scholarshipId: extra.scholarshipId || 's1', scholarshipTitle: extra.scholarshipTitle || 'Grant-in-Aid (GIA)' },
    startsAt: iso,
    startsAtDate,
    dateKey: extra.dateKey,
    mode: extra.mode || 'onsite',
    locationLabel: extra.locationLabel ?? 'Room 101',
  };
};

const items = [
  entry('a', 'Cruz, Ana', 'BS Biology', '2026-11-10T06:00:00Z', { dateKey: '2026-11-10' }),
  entry('b', 'Abad, Ben', 'BS Mathematics', '2026-11-13T01:00:00Z', { dateKey: '2026-11-13', mode: 'online', scholarshipId: 's2', scholarshipTitle: 'Jubilee Scholarship', locationLabel: '' }),
  entry('c', 'Dela Rosa, Cy', 'BS Biology', '2026-11-30T01:00:00Z', { dateKey: '2026-11-30' }),
];
const ids = (list) => list.map((item) => item.applicationId);

describe('interviewFilters', () => {
  it('sorts by start time, name, and scholarship', () => {
    const opts = { programIndex, now };
    expect(ids(filterInterviewItems(items, {}, opts))).toEqual(['a', 'b', 'c']);
    expect(ids(filterInterviewItems(items, { sort: 'latest' }, opts))).toEqual(['c', 'b', 'a']);
    expect(ids(filterInterviewItems(items, { sort: 'name' }, opts))).toEqual(['b', 'a', 'c']);
    expect(ids(filterInterviewItems(items, { sort: 'name-desc' }, opts))).toEqual(['c', 'a', 'b']);
    expect(ids(filterInterviewItems(items, { sort: 'scholarship' }, opts))).toEqual(['a', 'c', 'b']);
  });

  it('searches the applicant, scholarship, department, venue, and extra text', () => {
    const opts = { programIndex, now, extraTextOf: (item) => (item.applicationId === 'c' ? 'Dr. Reyes' : '') };
    expect(ids(filterInterviewItems(items, { query: 'abad' }, opts))).toEqual(['b']);
    expect(ids(filterInterviewItems(items, { query: 'jubilee' }, opts))).toEqual(['b']);
    expect(ids(filterInterviewItems(items, { query: 'mathematics' }, opts))).toEqual(['b']);
    expect(ids(filterInterviewItems(items, { query: 'room 101' }, opts))).toEqual(['a', 'c']);
    expect(ids(filterInterviewItems(items, { query: 'reyes' }, opts))).toEqual(['c']);
  });

  it('narrows by mode, date, scholarship, department, and program', () => {
    const opts = { programIndex, now };
    expect(ids(filterInterviewItems(items, { mode: 'online' }, opts))).toEqual(['b']);
    expect(ids(filterInterviewItems(items, { when: 'today' }, opts))).toEqual(['a']);
    expect(ids(filterInterviewItems(items, { when: 'week' }, opts))).toEqual(['a', 'b']);
    expect(ids(filterInterviewItems(items, { scholarshipId: 's1' }, opts))).toEqual(['a', 'c']);
    expect(ids(filterInterviewItems(items, { department: 'Mathematics' }, opts))).toEqual(['b']);
    expect(ids(filterInterviewItems(items, { program: 'BS Biology', mode: 'onsite' }, opts))).toEqual(['a', 'c']);
  });

  it('leaves an application that needs a schedule alone under the date and mode filters', () => {
    const waiting = { id: 'w', studentName: 'Waiting, Wes', studentProgram: 'BS Biology', scholarshipId: 's1', scholarshipTitle: 'Grant-in-Aid (GIA)', updatedAt: '2026-11-01T00:00:00Z' };
    expect(ids([...filterInterviewItems([waiting], { mode: 'online', when: 'today' }, { programIndex, now })].map((item) => ({ applicationId: item.id })))).toEqual(['w']);
    expect(filterInterviewItems([waiting], { query: 'wes' }, { programIndex, now })).toHaveLength(1);
    expect(filterInterviewItems([waiting], { query: 'nobody' }, { programIndex, now })).toHaveLength(0);
  });

  it('offers only the scholarships, departments, and programs present', () => {
    const facets = getInterviewFacets(items, programIndex);
    expect(facets.scholarships.map((option) => option.value)).toEqual(['s1', 's2']);
    expect(facets.departments.map((option) => option.value)).toEqual(['Biology', 'Mathematics']);
    expect(facets.programs.map((option) => option.value)).toEqual(['BS Biology', 'BS Mathematics']);
  });

  it('groups by day for time sorts and keeps one flat list otherwise', () => {
    const sorted = filterInterviewItems(items, {}, { programIndex, now });
    expect(groupInterviewsForSort(sorted, 'soonest').map((group) => group.dateKey)).toEqual(['2026-11-10', '2026-11-13', '2026-11-30']);
    const latest = filterInterviewItems(items, { sort: 'latest' }, { programIndex, now });
    expect(groupInterviewsForSort(latest, 'latest').map((group) => group.dateKey)).toEqual(['2026-11-30', '2026-11-13', '2026-11-10']);
    const flat = groupInterviewsForSort(filterInterviewItems(items, { sort: 'name' }, { programIndex, now }), 'name');
    expect(flat).toHaveLength(1);
    expect(flat[0].dateKey).toBe('');
    expect(isInterviewDaySort('name')).toBe(false);
    expect(groupInterviewsForSort([], 'soonest')).toEqual([]);
  });

  it('counts narrowing filters and detects any refinement', () => {
    expect(countActiveInterviewFilters(DEFAULT_INTERVIEW_FILTERS)).toBe(0);
    expect(countActiveInterviewFilters({ ...DEFAULT_INTERVIEW_FILTERS, mode: 'online', when: 'today' })).toBe(2);
    expect(hasInterviewRefinement(DEFAULT_INTERVIEW_FILTERS)).toBe(false);
    expect(hasInterviewRefinement({ ...DEFAULT_INTERVIEW_FILTERS, query: 'x' })).toBe(true);
    expect(hasInterviewRefinement({ ...DEFAULT_INTERVIEW_FILTERS, sort: 'name' })).toBe(true);
  });
});
