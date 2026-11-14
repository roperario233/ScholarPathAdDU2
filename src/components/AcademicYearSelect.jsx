import { ACADEMIC_YEAR_ALL } from '../lib/academicYearFilter';
import { formatAcademicYear } from '../lib/resultsRound';

// The academic-year dropdown shared by the work pages. Controlled: the page owns the
// choice (it opens on today's academic year) and the years its cases span.
export default function AcademicYearSelect({ value, onChange, years = [], className = '' }) {
  return (
    <label className={`flex min-w-0 items-center gap-2 text-sm font-semibold text-app-text ${className}`}>
      <span className="shrink-0 text-xs text-app-muted">Academic year</span>
      <select
        aria-label="Filter by academic year"
        className="min-h-10 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ACADEMIC_YEAR_ALL}>All academic years</option>
        {years.map((year) => (
          <option key={year} value={year}>{formatAcademicYear(year)}</option>
        ))}
      </select>
    </label>
  );
}
