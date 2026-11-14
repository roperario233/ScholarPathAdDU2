import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_QUEUE_FILTERS,
  countActiveReviewQueueFilters,
  filterReviewQueue,
  getReviewQueueFacets,
  hasReviewQueueRefinement,
} from '../src/lib/reviewQueue';

const programIndex = new Map([
  ['BS Biology', { school: 'School of Arts and Sciences', cluster: 'Natural Sciences', department: 'Biology' }],
  ['BS Mathematics', { school: 'School of Arts and Sciences', cluster: 'Natural Sciences', department: 'Mathematics' }],
]);

const entries = [
  { id: 'a', studentName: 'Cruz, Ana', scholarshipId: 's1', scholarshipTitle: 'Grant-in-Aid (GIA)', studentProgram: 'BS Biology', status: 'Interview', submittedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' },
  { id: 'b', studentName: 'Abad, Ben', scholarshipId: 's2', scholarshipTitle: 'Jubilee Scholarship', studentProgram: 'BS Mathematics', status: 'Endorsed', submittedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' },
  { id: 'c', studentName: 'Dela Rosa, Cy', scholarshipId: 's1', scholarshipTitle: 'Grant-in-Aid (GIA)', studentProgram: 'BS Biology', status: 'Recommended', submittedAt: '2026-09-20T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z' },
];

const ids = (list) => list.map((entry) => entry.id);

describe('reviewQueue', () => {
  it('sorts by most recently updated by default', () => {
    expect(ids(filterReviewQueue(entries, {}, programIndex))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by submission, name, scholarship, and stage', () => {
    expect(ids(filterReviewQueue(entries, { sort: 'oldest' }, programIndex))).toEqual(['c', 'a', 'b']);
    expect(ids(filterReviewQueue(entries, { sort: 'newest' }, programIndex))).toEqual(['b', 'a', 'c']);
    expect(ids(filterReviewQueue(entries, { sort: 'name' }, programIndex))).toEqual(['b', 'a', 'c']);
    expect(ids(filterReviewQueue(entries, { sort: 'name-desc' }, programIndex))).toEqual(['c', 'a', 'b']);
    expect(ids(filterReviewQueue(entries, { sort: 'scholarship' }, programIndex))).toEqual(['a', 'c', 'b']);
    expect(ids(filterReviewQueue(entries, { sort: 'stage' }, programIndex))).toEqual(['b', 'a', 'c']);
  });

  it('searches the applicant, scholarship, program, department, and stage label', () => {
    expect(ids(filterReviewQueue(entries, { query: 'abad' }, programIndex))).toEqual(['b']);
    expect(ids(filterReviewQueue(entries, { query: 'jubilee' }, programIndex))).toEqual(['b']);
    expect(ids(filterReviewQueue(entries, { query: 'mathematics' }, programIndex))).toEqual(['b']);
    expect(ids(filterReviewQueue(entries, { query: 'for interview' }, programIndex))).toEqual(['b']);
  });

  it('narrows by stage, scholarship, department, and program together', () => {
    expect(ids(filterReviewQueue(entries, { scholarshipId: 's1' }, programIndex))).toEqual(['a', 'c']);
    expect(ids(filterReviewQueue(entries, { scholarshipId: 's1', stage: 'Recommended' }, programIndex))).toEqual(['c']);
    expect(ids(filterReviewQueue(entries, { department: 'Mathematics' }, programIndex))).toEqual(['b']);
    expect(ids(filterReviewQueue(entries, { program: 'BS Biology', stage: 'Interview' }, programIndex))).toEqual(['a']);
  });

  it('offers only the values present in the scope as facets', () => {
    const facets = getReviewQueueFacets(entries, programIndex);
    expect(facets.stages.map((option) => option.value)).toEqual(['Endorsed', 'Interview', 'Recommended']);
    expect(facets.scholarships.map((option) => option.value)).toEqual(['s1', 's2']);
    expect(facets.departments.map((option) => option.value)).toEqual(['Biology', 'Mathematics']);
    expect(facets.programs.map((option) => option.value)).toEqual(['BS Biology', 'BS Mathematics']);
  });

  it('counts narrowing filters and detects any refinement', () => {
    expect(countActiveReviewQueueFilters(DEFAULT_REVIEW_QUEUE_FILTERS)).toBe(0);
    expect(countActiveReviewQueueFilters({ ...DEFAULT_REVIEW_QUEUE_FILTERS, stage: 'Interview', program: 'BS Biology' })).toBe(2);
    expect(hasReviewQueueRefinement(DEFAULT_REVIEW_QUEUE_FILTERS)).toBe(false);
    expect(hasReviewQueueRefinement({ ...DEFAULT_REVIEW_QUEUE_FILTERS, query: ' x ' })).toBe(true);
    expect(hasReviewQueueRefinement({ ...DEFAULT_REVIEW_QUEUE_FILTERS, sort: 'name' })).toBe(true);
  });
});
