import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_YEAR_ALL,
  filterByAcademicYear,
  getAcademicYearChoices,
  getApplicationAcademicYear,
  matchesAcademicYear,
  resolveAcademicYear,
} from '../src/lib/academicYearFilter';
import { filterIntakePool } from '../src/lib/admissionsOffice';

const apps = [
  { id: 'a', status: 'Submitted', submittedAt: '2026-10-05T00:00:00Z' },
  { id: 'b', status: 'Submitted', submittedAt: '2026-03-01T00:00:00Z' },
  { id: 'c', status: 'Submitted', updatedAt: '2026-07-01T00:00:00Z' },
  { id: 'd', status: 'Submitted' },
];

describe('academic year filter', () => {
  it('files an application under the year it was submitted in (June start)', () => {
    expect(getApplicationAcademicYear(apps[0])).toBe('2026-2027');
    expect(getApplicationAcademicYear(apps[1])).toBe('2025-2026');
    expect(getApplicationAcademicYear(apps[2])).toBe('2026-2027');
    expect(getApplicationAcademicYear(apps[3])).toBe('');
  });

  it('narrows to one year and leaves everything for "all"', () => {
    expect(filterByAcademicYear(apps, '2026-2027').map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(filterByAcademicYear(apps, '2025-2026').map((entry) => entry.id)).toEqual(['b']);
    expect(filterByAcademicYear(apps, ACADEMIC_YEAR_ALL)).toHaveLength(4);
    expect(matchesAcademicYear(apps[1], '2026-2027')).toBe(false);
  });

  it('lists the years the cases span, newest first, always with today\'s', () => {
    const today = new Date('2026-11-14T00:00:00Z');
    expect(getAcademicYearChoices(apps, today)).toEqual(['2026-2027', '2025-2026']);
    expect(getAcademicYearChoices([], today)).toEqual(['2026-2027']);
  });

  it('reads a choice that no longer exists as all years', () => {
    expect(resolveAcademicYear('2024-2025', ['2026-2027'])).toBe(ACADEMIC_YEAR_ALL);
    expect(resolveAcademicYear('2026-2027', ['2026-2027'])).toBe('2026-2027');
    expect(resolveAcademicYear(ACADEMIC_YEAR_ALL, [])).toBe(ACADEMIC_YEAR_ALL);
  });

  it('applies to the intake pool filter without changing its default', () => {
    expect(filterIntakePool(apps, [], { coverage: 'all' }).map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(filterIntakePool(apps, [], { coverage: 'all', academicYear: '2026-2027' }).map((entry) => entry.id).sort()).toEqual(['a', 'c']);
  });
});
