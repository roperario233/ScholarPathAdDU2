import { getCurrentAcademicYear } from './profile.js';

// The academic-year dropdown on the Admissions Office and reviewer work pages
// (intake pool, review queue, interviews). An application belongs to the year it was
// submitted in, read the same way the results rounds and the statistics read it, so
// every page files a case under one year. `all` means no narrowing. Pages open on
// today's academic year (June start) and offer every year their cases span.

export const ACADEMIC_YEAR_ALL = 'all';

const asList = (value) => (Array.isArray(value) ? value : []);

export const getApplicationAcademicYear = (application = {}) => {
  const time = Date.parse(application?.submittedAt || application?.updatedAt || '');
  return Number.isFinite(time) ? getCurrentAcademicYear(new Date(time)) : '';
};

export const matchesAcademicYear = (application, year = ACADEMIC_YEAR_ALL) => (
  !year || year === ACADEMIC_YEAR_ALL || getApplicationAcademicYear(application) === year
);

export const filterByAcademicYear = (applications = [], year = ACADEMIC_YEAR_ALL) => (
  !year || year === ACADEMIC_YEAR_ALL
    ? asList(applications)
    : asList(applications).filter((application) => matchesAcademicYear(application, year))
);

// Newest first, always including today's year so the default choice exists before
// any case does.
export const getAcademicYearChoices = (applications = [], today = new Date()) => {
  const years = new Set(asList(applications).map(getApplicationAcademicYear).filter(Boolean));
  years.add(getCurrentAcademicYear(today));
  return [...years].sort((left, right) => right.localeCompare(left));
};

// A saved choice that no longer exists (the cases moved on) reads as all years.
export const resolveAcademicYear = (choice, choices = []) => (
  choice === ACADEMIC_YEAR_ALL || asList(choices).includes(choice) ? choice : ACADEMIC_YEAR_ALL
);

export const getDefaultAcademicYear = (today = new Date()) => getCurrentAcademicYear(today);
