import { describe, expect, it } from 'vitest';
import {
  getReleaseAcademicYear,
  getResultsYearOptions,
  matchesResultsFilter,
} from '../src/lib/resultsRound';

describe('results filters', () => {
  const applicationById = new Map([
    ['a1', { id: 'a1', submittedAt: '2026-10-05T00:00:00Z' }],
    ['a2', { id: 'a2', submittedAt: '2026-10-09T00:00:00Z' }],
    ['old', { id: 'old', submittedAt: '2025-09-01T00:00:00Z' }],
  ]);

  it('reads a release academic year from the applications it covered', () => {
    expect(getReleaseAcademicYear({ applicationIds: ['a1', 'a2'] }, applicationById)).toBe('2026-2027');
    expect(getReleaseAcademicYear({ applicationIds: ['old'] }, applicationById)).toBe('2025-2026');
  });

  it('falls back to the release date when no covered application is loaded', () => {
    expect(getReleaseAcademicYear({ applicationIds: ['missing'], releasedAt: '2026-03-01T00:00:00Z' }, applicationById)).toBe('2025-2026');
    expect(getReleaseAcademicYear({ applicationIds: [], releasedAt: '2026-10-29T00:00:00Z' }, applicationById)).toBe('2026-2027');
  });

  it('lists years newest first and always includes today\'s', () => {
    const today = new Date('2026-11-14T00:00:00Z');
    expect(getResultsYearOptions(['2025-2026', '2025-2026', ''], today)).toEqual(['2026-2027', '2025-2026']);
    expect(getResultsYearOptions([], today)).toEqual(['2026-2027']);
  });

  it('matches on the grant and the year, with all meaning no narrowing', () => {
    const round = { scholarshipId: 's1', academicYear: '2026-2027' };
    expect(matchesResultsFilter(round, {})).toBe(true);
    expect(matchesResultsFilter(round, { grant: 's1', year: '2026-2027' })).toBe(true);
    expect(matchesResultsFilter(round, { grant: 's2' })).toBe(false);
    expect(matchesResultsFilter(round, { year: '2025-2026' })).toBe(false);
    expect(matchesResultsFilter(round, { grant: 's1', year: 'all' })).toBe(true);
  });
});
