import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OpenApplicationForStudentModal from '../src/components/OpenApplicationForStudentModal';
import { APPLICATION_ELIGIBILITY_EXCEPTION_PREFIX, ELIGIBILITY_EXCEPTION_REASONS } from '../src/lib/constants';

// An eligibility exception: the Admissions Office Admin opens a Draft for a
// student the qualification rules block. The reason is staff-only, so the
// dialog says so, and the prefix must match open_application_for_student().

const students = {
  'student-1': { fullName: 'Ana Reyes', role: 'student', degreeProgram: 'BS Information Technology', qpi: 2.1, householdIncome: 180000 },
  'staff-1': { fullName: 'Office Staff', role: 'admissions_office', degreeProgram: '', qpi: null, householdIncome: null },
};
const scholarships = [
  { id: 'gia', title: 'Grant-in-Aid (GIA)', isActive: true, deadline: '2999-12-31', minimumQpi: 2.5, maximumIncome: 250000 },
  { id: 'donor', title: 'Donor Endowment', isActive: true, deadline: '2999-12-31' },
];

describe('office-opened applications', () => {
  it('files the reason under the same prefix the database writes', () => {
    expect(APPLICATION_ELIGIBILITY_EXCEPTION_PREFIX).toBe('Eligibility exception — ');
    expect(ELIGIBILITY_EXCEPTION_REASONS.find((option) => option.value === 'other').requiresNotes).toBe(true);
  });

  it('renders the pickers above the reason fields and states the reason is staff-only', () => {
    const markup = renderToStaticMarkup(
      <OpenApplicationForStudentModal students={students} scholarships={scholarships} onConfirm={() => ({ ok: true })} onClose={() => {}} />,
    );
    expect(markup).toContain('Open an application for a student');
    expect(markup).toContain('Student');
    expect(markup).toContain('Scholarship');
    expect(markup).toContain('Recorded in the staff-only internal notes.');
    expect(markup).toContain('Recommended by faculty or the department');
    expect(markup.indexOf('Scholarship')).toBeLessThan(markup.indexOf('Reason for the eligibility exception'));
    expect(markup).toContain('Open application');
  });
});
